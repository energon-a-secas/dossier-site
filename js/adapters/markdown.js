/**
 * Markdown adapter: convert Markdown to Dossier blocks
 *
 * A level 1 heading starts a page, deeper headings become heading blocks
 * (level 2, or 3 for anything deeper, since the format has no h4), paragraphs
 * become prose, fenced code becomes code, tables become table, blockquotes
 * become callout. Front matter fills the meta.
 *
 * Every block is written in the registry's own field names. This adapter used
 * to write `title` on a heading and `note` on a callout, which the renderers
 * never read, so every imported heading and blockquote lost its words and the
 * validator reported four errors on a plain Markdown file.
 *
 * Front matter is read through the registry's META, not copied whole. Keys
 * such as `author` and `date` used to land on the document, where the
 * validator said nothing and the published schema (additionalProperties
 * false) refused the file. Now a declared key is copied when its value fits
 * the field, `author` fills `owner`, and everything else is named in one info
 * finding so the reader knows what was left out.
 *
 * With no front-matter title, the report is named from its own text: the
 * one level-1 heading (which then is not repeated as a page title), the file
 * name, or the first heading of any level. Every agent Markdown file without
 * front matter used to open as "Document", so the saved list filled with
 * entries no one could tell apart.
 *
 * Pure, DOM-free.
 */

import { META, PAGE, KINDS, STATUSES } from '../registry/types.js';

/** Front-matter keys copied as one-line strings, with the field's own limit. */
const STRING_KEYS = ['title', 'subtitle', 'owner'];
const ENUM_KEYS = { kind: KINDS, status: STATUSES, chrome: META.chrome.values || [] };

/**
 * @param {string} source
 * @param {{name?: string}} [opts] the file name the text came from, when it
 *   came from a file
 * @returns {{ document: Document|null, findings: Array }}
 */
export function toDossier(source, { name } = {}) {
  const findings = [];

  if (!source || typeof source !== 'string') {
    return { document: null, findings };
  }

  let frontMatter = '';
  // Windows line endings would leave a carriage return on every fenced code
  // line and stop the front matter from matching.
  const text = source.replace(/\r\n?/g, '\n');
  let body = text;

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    frontMatter = fmMatch[1];
    body = fmMatch[2];
  }

  const meta = frontMatter ? metaFromFrontMatter(parseYamlFront(frontMatter), findings) : {};
  const blocks = parseMarkdown(body);
  const tops = blocks.filter((block) => block.type === 'heading' && block.level === 1);
  // One H1 and no front-matter title: the H1 is the report's title, and its
  // page gets the neutral title the no-H1 path uses, so it is not shown twice.
  const promoted = !meta.title && tops.length === 1 ? tops[0] : null;

  // `version` is the format's version, always 1. A front-matter version is
  // the document's own revision and is not copied over it.
  const doc = {
    version: 1,
    ...meta,
    title: meta.title || titleFrom(blocks, tops, name),
    pages: [],
  };

  let pages = [];
  let currentPage = null;
  let currentBlocks = [];

  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 1) {
      if (currentPage) {
        currentPage.blocks = currentBlocks;
        pages.push(currentPage);
        currentBlocks = [];
      }
      currentPage = { title: block === promoted ? 'Content' : clamp(plainHeading(block.text), PAGE.title.maxLen), blocks: [] };
    } else if (block.type === 'heading') {
      currentBlocks.push({
        type: 'heading',
        level: block.level === 2 ? 2 : 3,
        text: block.text,
      });
    } else {
      currentBlocks.push(block);
    }
  }

  if (currentPage) {
    currentPage.blocks = currentBlocks;
    pages.push(currentPage);
  }

  if (pages.length === 0) {
    pages = [{
      title: 'Content',
      blocks: currentBlocks,
    }];
  }

  doc.pages = pages;

  const document = { dossier: doc };
  return { document, findings };
}

/**
 * The report's title when front matter gives none: the one H1; with several,
 * the file name or the first H1; with none, the file name or the first
 * heading of any level; then "Document".
 */
function titleFrom(blocks, tops, name) {
  const file = fileTitle(name);
  const heading = (block) => (block ? plainHeading(block.text) : '');
  let title = '';
  if (tops.length === 1) title = heading(tops[0]);
  else if (tops.length > 1) title = file || heading(tops[0]);
  else title = file || heading(blocks.find((block) => block.type === 'heading'));
  return clamp(title, META.title.maxLen) || 'Document';
}

/**
 * A file name as a title: the base name, without a Markdown or text
 * extension, with runs of `_` and `-` read as spaces. The Open dialog's
 * "Pasted text" label is not a file name.
 */
function fileTitle(name) {
  if (typeof name !== 'string' || !name.trim() || name === 'Pasted text') return '';
  const base = name.split(/[\\/]/).pop().replace(/\.(md|markdown|txt)$/i, '');
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A heading's words without the simple inline Markdown around them. */
function plainHeading(text) {
  return String(text || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\W)[*_]+|[*_]+(?=\W|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut a title to a field's limit, ending on an ellipsis when it was cut. */
function clamp(text, max) {
  const value = String(text || '').trim();
  if (!max || value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}\u2026`;
}

/**
 * The META fields front matter can fill, each only when its value fits.
 * Anything else is reported once, by name, at info level.
 */
function metaFromFrontMatter(front, findings) {
  const meta = {};
  const used = new Set();
  const line = (value) => (typeof value === 'string' || typeof value === 'number')
    ? String(value).replace(/\s+/g, ' ').trim() : '';

  for (const key of STRING_KEYS) {
    const value = line(front[key]);
    if (!value) continue;
    meta[key] = value.slice(0, META[key].maxLen || value.length);
    used.add(key);
  }
  if (!meta.owner && line(front.author)) {
    meta.owner = line(front.author).slice(0, META.owner.maxLen || 80);
    used.add('author');
  }
  for (const [key, values] of Object.entries(ENUM_KEYS)) {
    if (values.includes(front[key])) {
      meta[key] = front[key];
      used.add(key);
    }
  }
  if (typeof front.tags === 'string' && front.tags.trim()) {
    const tags = front.tags.replace(/^\[|\]$/g, '').split(',')
      .map((t) => unquote(t.trim())).filter(Boolean)
      .slice(0, META.tags.max || 12);
    if (tags.length) {
      meta.tags = tags;
      used.add('tags');
    }
  }

  const left = Object.keys(front).filter((key) => !used.has(key) && key !== 'version');
  if (left.length) {
    findings.push({
      level: 'info',
      message: `Front matter left out, because Dossier has no such field or the value does not fit it: ${left.join(', ')}.`,
      path: 'dossier',
      page: null,
      rule: 'import.markdown.frontmatter',
    });
  }
  return meta;
}

function unquote(value) {
  const m = /^(["'])([\s\S]*)\1$/.exec(value);
  return m ? m[2] : value;
}

function parseYamlFront(front) {
  const obj = {};
  const lines = front.split('\n');

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const raw = match[2].trim();
      let value = unquote(raw);

      // A quoted value stays a string, as it does in YAML.
      if (value === raw) {
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      }

      obj[key] = value;
    }
  }

  return obj;
}

function parseMarkdown(text) {
  const blocks = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.match(/^#{1,6}\s+/)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.substring(level).trim();
      blocks.push({ type: 'heading', level, text });
      i++;
    } else if (line.startsWith('```')) {
      const lang = line.substring(3).trim();
      i++;
      const code = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++;
      const block = { type: 'code', source: code.join('\n') };
      if (lang) block.language = lang;
      blocks.push(block);
    } else if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = parseTable(tableLines);
      if (table) blocks.push(table);
    } else if (line.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].substring(1).trim());
        i++;
      }
      blocks.push({
        type: 'callout',
        text: quoteLines.join('\n'),
      });
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !lines[i].match(/^#{1,6}\s+/) && !lines[i].startsWith('```') && !lines[i].startsWith('|') && !lines[i].startsWith('>')) {
        para.push(lines[i]);
        i++;
      }
      if (para.length > 0) {
        blocks.push({
          type: 'prose',
          text: para.join('\n'),
        });
      }
    }
  }

  return blocks;
}

function parseTable(lines) {
  if (lines.length < 2) return null;

  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const headers = cells(lines[0]);
  const rows = [];

  for (let i = 2; i < lines.length; i++) {
    rows.push(cells(lines[i]));
  }

  return {
    type: 'table',
    columns: headers.map((h) => ({ label: h })),
    rows,
  };
}
