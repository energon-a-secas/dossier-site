/**
 * Markdown to the compare IR (js/compare/ir.js). DOM-free: node imports it.
 *
 * Its own small parser rather than js/adapters/markdown.js: that adapter makes
 * Dossier blocks (prose strings, a page per level 1 heading, heading levels
 * clamped to 2 and 3, nested lists flattened), which is right for opening a
 * Markdown file as a report and loses exactly what a side-by-side reading
 * needs: real heading levels, nested lists and inline runs.
 *
 * Covered: ATX and setext headings, paragraphs, nested ordered and unordered
 * lists, fenced and indented code, GFM tables, block quotes, rules; inline
 * bold, italic, code, links, images, autolinks, bare URLs, strikethrough (as
 * plain text), backslash escapes and hard breaks. Raw HTML is read as text
 * with its tags removed, never as markup, except `<script>` and `<style>`,
 * which go with everything inside them: a browser shows none of it, so it is
 * not part of what the report says.
 */

import { safeHref, safeImageSrc } from '../render/url.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** A line that opens a script or style block (CommonMark's HTML block, type 1). */
const RAW_BLOCK = /^ {0,3}<(script|style)(?=[\s>/]|$)/i;
/**
 * A script or style element inside a paragraph, to its end tag or the end of
 * the text; a code span is matched first so what it shows is left alone.
 */
const RAW_INLINE = /(`+)[\s\S]*?[^`]\1(?!`)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\2\s*>|$)/gi;

/**
 * @param {string} source
 * @returns {{blocks: Array, title: string}}
 */
export function markdownToIr(source) {
  let text = String(source || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  text = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const ctx = { slugs: new Map(), headings: 0, links: [] };
  const blocks = parseBlocks(text.split('\n'), ctx);
  for (const ref of ctx.links) {
    if (!ref.raw.startsWith('#')) continue;
    const n = ctx.slugs.get(ref.raw.slice(1).toLowerCase());
    if (n) ref.run.local = n;
    else delete ref.run.local;
  }
  const first = blocks.find((b) => b.t === 'h' && b.level === 1);
  return { blocks, title: first ? plain(first.inl) : '' };
}

function plain(inl) {
  return inl.map((run) => run.text ?? run.code ?? (run.br ? ' ' : plain(run.b || run.i || run.a || []))).join('');
}

/** GitHub-style heading slug, so `[x](#root-cause)` finds "Root cause". */
function slug(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function parseBlocks(lines, ctx) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      const inl = inlineRuns(para.join('\n'), ctx);
      const images = inl.filter((run) => run.img);
      if (images.length && inl.every((run) => run.img || (run.text !== undefined && !run.text.trim()) || run.br)) {
        for (const run of images) out.push(figure(run.img));
      } else {
        const runs = inl.flatMap((run) => (run.img ? (run.img.alt ? [{ text: run.img.alt }] : []) : [run]));
        if (runs.length) out.push({ t: 'p', inl: runs });
      }
    }
    para = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      out.push(fence[2] ? { t: 'pre', text: body.join('\n'), lang: fence[2] } : { t: 'pre', text: body.join('\n') });
      continue;
    }

    const raw = RAW_BLOCK.exec(line);
    if (raw) {
      flush();
      i = skipRawBlock(lines, i, raw[1], para);
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      flush();
      out.push(heading(atx[1].length, atx[2] || '', ctx));
      continue;
    }

    if (para.length && SETEXT.test(line) && !ITEM.test(para[para.length - 1])) {
      const level = line.trim()[0] === '=' ? 1 : 2;
      const words = para.join(' ');
      para = [];
      out.push(heading(level, words, ctx));
      continue;
    }

    if (HR.test(line)) { flush(); out.push({ t: 'hr' }); continue; }

    if (QUOTE.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || body.length)) {
        const m = QUOTE.exec(lines[i]);
        body.push(m ? m[1] : lines[i]);
        i += 1;
      }
      i -= 1;
      const blocks = parseBlocks(body, ctx);
      if (blocks.length) out.push({ t: 'quote', blocks });
      continue;
    }

    if (ITEM.test(line) && (!para.length || /^ *([-*+]|1[.)])[ \t]/.test(line))) {
      flush();
      const start = i;
      i = listEnd(lines, i);
      out.push(parseList(lines.slice(start, i), ctx));
      i -= 1;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = [splitRow(line)];
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      const cell = (value) => ({ inl: inlineRuns(value, ctx).filter((run) => !run.img) });
      out.push({ t: 'table', head: head.map((r) => r.map(cell)), rows: rows.map((r) => r.map(cell)) });
      continue;
    }

    if (!para.length && /^ {4,}\S/.test(line)) {
      const body = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || !lines[i].trim())) {
        body.push(lines[i].slice(4));
        i += 1;
      }
      i -= 1;
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push({ t: 'pre', text: body.join('\n') });
      continue;
    }

    para.push(line.replace(/^ {0,3}/, ''));
  }
  flush();
  return out;
}

/**
 * Skip a script or style block from line `start`: it runs to the line that
 * holds its end tag, or to the end of the document, as CommonMark reads it.
 * Words after the end tag on that line are kept, as the start of `para`.
 *
 * @returns {number} the index of the block's last line
 */
function skipRawBlock(lines, start, name, para) {
  const end = new RegExp(`</${name}\\s*>`, 'i');
  for (let i = start; i < lines.length; i += 1) {
    // The end tag is looked for after the opening tag on the first line.
    const from = i === start ? lines[i].search(/>/) + 1 : 0;
    const found = from > 0 || i > start ? end.exec(lines[i].slice(from)) : null;
    if (found) {
      const after = lines[i].slice(from + found.index + found[0].length);
      if (after.trim()) para.push(after.trim());
      return i;
    }
  }
  return lines.length - 1;
}

function heading(level, raw, ctx) {
  const inl = inlineRuns(raw.trim(), ctx);
  ctx.headings += 1;
  const key = slug(plain(inl));
  if (key && !ctx.slugs.has(key)) ctx.slugs.set(key, ctx.headings);
  return { t: 'h', level, inl: inl.length ? inl : [{ text: '' }] };
}

function figure(img) {
  const fig = { t: 'fig', alt: img.alt || '' };
  if (img.src) fig.src = img.src;
  if (img.note) fig.note = img.note;
  return fig;
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

// ── Lists ────────────────────────────────────────────────────────────────────

/** The index after the last line of the list starting at `start`. */
function listEnd(lines, start) {
  const baseIndent = ITEM.exec(lines[start])[1].length;
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless the list goes on after it.
      const next = lines[i + 1];
      if (next === undefined || !next.trim()) break;
      const m = ITEM.exec(next);
      if ((m && m[1].length >= baseIndent) || /^ {2,}\S/.test(next)) { i += 1; continue; }
      break;
    }
    const m = ITEM.exec(line);
    if (m && m[1].length < baseIndent) break;
    if (!m && !/^ {2,}/.test(line) && (ATX.test(line) || HR.test(line) || FENCE.test(line) || QUOTE.test(line))) break;
    i += 1;
  }
  return i;
}

function parseList(lines, ctx) {
  const first = ITEM.exec(lines[0]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let current = null;
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (m && m[1].length <= indent + 1 && (/\d/.test(m[2]) === ordered || m[1].length < indent + 2)) {
      current = { head: [m[3] || ''], nested: [] };
      items.push(current);
      continue;
    }
    if (!current) continue;
    if (!line.trim()) { current.nested.push(''); continue; }
    if (m || current.nested.length) current.nested.push(line);
    else current.head.push(line.trim());
  }
  return {
    t: 'list',
    ordered,
    items: items.map((item) => {
      const out = { inl: inlineRuns(item.head.join('\n'), ctx).filter((run) => !run.img) };
      const nested = item.nested.filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1));
      if (nested.some((l) => ITEM.test(l))) {
        const start = nested.findIndex((l) => ITEM.test(l));
        const sub = parseList(nested.slice(start).map((l) => l.replace(/^ {2,4}/, '')), ctx);
        if (sub.items.length) out.sub = sub;
      } else if (nested.some((l) => l.trim())) {
        out.inl.push({ br: 1 }, ...inlineRuns(nested.map((l) => l.trim()).join('\n'), ctx));
      }
      return out;
    }),
  };
}

// ── Inline ───────────────────────────────────────────────────────────────────

function image(alt, src) {
  const raw = src.trim();
  if (/^data:image\//i.test(raw)) {
    const safe = safeImageSrc(raw);
    return safe ? { src: safe, alt } : { alt, note: 'An embedded image in a format this page does not show' };
  }
  if (/^(https?:)?\/\//i.test(raw)) {
    let host = 'another site';
    try { host = new URL(raw, 'https://invalid.invalid/').host; } catch { /* keep the generic name */ }
    return { alt, note: `Remote image from ${host} not loaded` };
  }
  const name = raw.split(/[?#]/)[0].split('/').pop() || raw;
  return { alt, note: `Image ${name.slice(0, 80)} is not part of the file` };
}

function link(inl, raw, ctx) {
  const target = raw.trim().replace(/^<|>$/g, '').split(/\s+["'(]/)[0];
  const run = { a: inl.length ? inl : [{ text: target }] };
  if (target.startsWith('#')) {
    run.local = true;
    ctx.links.push({ run, raw: target });
    return run;
  }
  const href = safeHref(target);
  if (href && /^(https?:|mailto:)/i.test(href)) run.href = href;
  return run;
}

/**
 * Inline runs from a paragraph's text. A small left-to-right scanner: code
 * spans first (nothing inside them is markup), then images, links,
 * autolinks, emphasis and the rest as text.
 */
export function inlineRuns(source, ctx = { links: [] }) {
  // Scripts and styles go with their contents; other tags go and their words
  // stay. An autolink (`<https://...>`) is not a tag.
  const text = String(source || '')
    .replace(RAW_INLINE, (match, ticks) => (ticks ? match : ''))
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, (tag) => (/^<br\b/i.test(tag) ? '\n' : ''));
  return mergeText(scan(text, ctx));
}

function scan(text, ctx) {
  const out = [];
  let buf = '';
  const push = (run) => {
    if (buf) out.push({ text: buf });
    buf = '';
    out.push(run);
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);
    if (ch === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!|~<>]/.test(text[i + 1])) {
      buf += text[i + 1]; i += 2; continue;
    }
    if (ch === '\\' && text[i + 1] === '\n') { push({ br: 1 }); i += 2; continue; }
    if (ch === '\n') {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); push({ br: 1 }); } else buf += ' ';
      i += 1; continue;
    }
    if (ch === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
      if (m) { push({ code: m[2].replace(/\n/g, ' ').trim() }); i += m[0].length; continue; }
    }
    if (ch === '!' && text[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(([^)\s]*(?:\s+"[^"]*")?)\)/.exec(rest);
      if (m) { push({ img: image(m[1], m[2].split(/\s+"/)[0]) }); i += m[0].length; continue; }
    }
    if (ch === '[') {
      const m = /^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^()\s]*(?:\([^)]*\))?[^()\s]*(?:\s+"[^"]*")?)\)/.exec(rest);
      if (m) { push(link(scan(m[1], ctx).filter((r) => !r.img), m[2], ctx)); i += m[0].length; continue; }
    }
    if (ch === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/i.exec(rest);
      if (m) { push(link([], m[1], ctx)); i += m[0].length; continue; }
    }
    if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(rest) && !/[\w/]$/.test(buf)) {
      const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/i.exec(rest);
      if (m) { push(link([], m[0], ctx)); i += m[0].length; continue; }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const strong = new RegExp(`^\\${ch}\\${ch}(?=\\S)([\\s\\S]*?\\S)\\${ch}\\${ch}`).exec(rest);
      if (strong && (ch !== '_' || !/\w$/.test(buf))) {
        const inner = scan(strong[1], ctx);
        push(ch === '~' ? { text: plain(inner) } : { b: inner });
        i += strong[0].length; continue;
      }
      const em = ch !== '~' && new RegExp(`^\\${ch}(?=\\S)([\\s\\S]*?[^\\s\\${ch}])\\${ch}(?!\\${ch})`).exec(rest);
      if (em && (ch !== '_' || (!/\w$/.test(buf) && !/^\w/.test(text.slice(i + em[0].length))))) {
        push({ i: scan(em[1], ctx) });
        i += em[0].length; continue;
      }
    }
    buf += ch;
    i += 1;
  }
  if (buf) out.push({ text: buf });
  return out;
}

function mergeText(runs) {
  const out = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (typeof run.text === 'string' && last && typeof last.text === 'string') last.text += run.text;
    else out.push(run);
  }
  if (out.length && typeof out[0].text === 'string') out[0].text = out[0].text.replace(/^\s+/, '');
  const last = out[out.length - 1];
  if (last && typeof last.text === 'string') last.text = last.text.replace(/\s+$/, '');
  return out.filter((run) => run.text !== '');
}
