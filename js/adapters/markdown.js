/**
 * Markdown adapter: convert Markdown to Dossier blocks
 *
 * Headings become pages and heading blocks, paragraphs become prose,
 * fenced code becomes code, tables become table, blockquotes become callout.
 * Front matter fills the meta.
 *
 * Pure, DOM-free.
 */

/**
 * @param {string} source
 * @returns {{ document: Document|null, findings: Array }}
 */
export function toDossier(source) {
  const findings = [];

  if (!source || typeof source !== 'string') {
    return { document: null, findings };
  }

  let frontMatter = '';
  let body = source;

  const fmMatch = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    frontMatter = fmMatch[1];
    body = fmMatch[2];
  }

  let meta = {};
  if (frontMatter) {
    meta = parseYamlFront(frontMatter);
  }

  const doc = {
    version: meta.version || 1,
    title: meta.title || 'Document',
    ...meta,
    pages: [],
  };

  const blocks = parseMarkdown(body);
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
      currentPage = { title: block.text, blocks: [] };
    } else if (block.type === 'heading' && block.level === 2) {
      currentBlocks.push({
        type: 'heading',
        title: block.text,
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

function parseYamlFront(front) {
  const obj = {};
  const lines = front.split('\n');

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      if (value === 'true') value = true;
      if (value === 'false') value = false;
      if (/^\d+$/.test(value)) value = parseInt(value, 10);

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
      blocks.push({
        type: 'code',
        source: code.join('\n'),
        language: lang || undefined,
      });
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
        note: quoteLines.join('\n'),
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
