/**
 * The intermediate representation every compare column reads in Dossier
 * format, whatever it was written in. DOM-free: node imports it.
 *
 * HTML (js/compare/normalize.js), Markdown (js/compare/markdown-ir.js) and
 * plain text all become one array of blocks, so the reader, the statistics,
 * the section alignment and the differences see one shape and never the
 * source's own markup. Rendering it (js/compare/ir-render.js) escapes every
 * string, so no source markup ever reaches the page.
 *
 * Blocks:
 *   {t:'h', level, inl}                       a heading, level 1 to 6
 *   {t:'p', inl}                              a paragraph
 *   {t:'list', ordered, items:[{inl, sub?}]}  sub is a nested list block
 *   {t:'table', caption?, head:[[cell]], rows:[[cell]]}
 *                                             cell = {inl, colspan?, rowspan?}
 *   {t:'pre', text, lang?}                    preformatted text or code
 *   {t:'quote', blocks}                       a block quote
 *   {t:'fig', src?, alt, caption?, note?}     src is a data: image or absent
 *   {t:'hr'}
 *   {t:'details', summary, blocks}            summary is inline runs
 *
 * Inline runs (`inl` is an array of these):
 *   {text}  {b: inl}  {i: inl}  {code: text}  {a: inl, href?, local?}
 *   {br: 1} {sub: inl} {sup: inl} {mark: inl}
 *   `href` is an absolute http, https or mailto address. `local` is the
 *   1-based number of a heading in the same column (an in-page link), which
 *   the renderer turns into that heading's id.
 */

/** Wrapper keys whose value is a nested inline array. */
export const WRAPPERS = Object.freeze(['b', 'i', 'a', 'sub', 'sup', 'mark']);

/** The wrapper key of a run, or null for a leaf (text, code, br). */
export function wrapperOf(run) {
  if (!run || typeof run !== 'object') return null;
  for (const key of WRAPPERS) {
    if (Array.isArray(run[key])) return key;
  }
  return null;
}

/** Plain text of inline runs. A line break reads as a space. */
export function inlineText(inl) {
  if (!Array.isArray(inl)) return '';
  let out = '';
  for (const run of inl) {
    if (!run || typeof run !== 'object') continue;
    if (typeof run.text === 'string') out += run.text;
    else if (typeof run.code === 'string') out += run.code;
    else if (run.br) out += ' ';
    else {
      const key = wrapperOf(run);
      if (key) out += inlineText(run[key]);
    }
  }
  return out;
}

/** Plain text of one block, for statistics and search. */
export function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.t) {
    case 'h':
    case 'p':
      return inlineText(block.inl);
    case 'list':
      return (block.items || []).map((item) => [inlineText(item.inl), item.sub ? blockText(item.sub) : '']
        .filter(Boolean).join(' ')).join(' ');
    case 'table':
      return [
        block.caption ? inlineText(block.caption) : '',
        ...[...(block.head || []), ...(block.rows || [])]
          .map((row) => row.map((cell) => inlineText(cell.inl)).join(' ')),
      ].filter(Boolean).join(' ');
    case 'pre':
      return String(block.text || '');
    case 'quote':
      return (block.blocks || []).map(blockText).join(' ');
    case 'fig':
      return [block.alt, block.caption].filter(Boolean).join(' ');
    case 'details':
      return [inlineText(block.summary), ...(block.blocks || []).map(blockText)].join(' ');
    default:
      return '';
  }
}

/**
 * The units a reader compares, in document order: headings, paragraphs, list
 * items, table rows, code blocks, and the paragraphs inside quotes and
 * disclosures. The renderer numbers units in exactly this order (`data-u`),
 * so a difference computed on this list lands on the right element.
 *
 * @param {Array} blocks
 * @returns {Array<{kind: string, text: string, level?: number}>}
 */
export function flattenUnits(blocks) {
  const units = [];
  visitUnits(blocks, (unit) => units.push(unit));
  return units;
}

/**
 * Walk the units of a block list in render order. The callback receives
 * `{kind, text, level?, node}`, where `node` is the block, list item or row.
 */
export function visitUnits(blocks, fn) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue;
    switch (block.t) {
      case 'h':
        fn({ kind: 'h', level: block.level, text: inlineText(block.inl), node: block });
        break;
      case 'p':
        fn({ kind: 'p', text: inlineText(block.inl), node: block });
        break;
      case 'list':
        visitItems(block, fn);
        break;
      case 'table':
        for (const row of [...(block.head || []), ...(block.rows || [])]) {
          fn({ kind: 'tr', text: row.map((cell) => inlineText(cell.inl)).join(' | '), node: row });
        }
        break;
      case 'pre':
        fn({ kind: 'pre', text: String(block.text || ''), node: block });
        break;
      case 'quote':
        visitUnits(block.blocks, fn);
        break;
      case 'details':
        fn({ kind: 'p', text: inlineText(block.summary), node: block });
        visitUnits(block.blocks, fn);
        break;
      default:
        break;
    }
  }
}

function visitItems(list, fn) {
  for (const item of list.items || []) {
    fn({ kind: 'li', text: inlineText(item.inl), node: item });
    if (item.sub) visitItems(item.sub, fn);
  }
}

/** The headings of a block list, in order, with their 1-based number. */
export function headingsOf(blocks) {
  const out = [];
  const walk = (list) => {
    for (const block of Array.isArray(list) ? list : []) {
      if (!block) continue;
      if (block.t === 'h') out.push({ level: block.level, text: inlineText(block.inl).trim(), n: out.length + 1 });
      else if (block.t === 'quote' || block.t === 'details') walk(block.blocks);
    }
  };
  walk(blocks);
  return out;
}

/**
 * Plain text as IR: a blank line separates paragraphs, and a single line
 * break stays a line break. Nothing is guessed: no headings, no lists.
 */
export function textToIr(text) {
  const clean = String(text || '').replace(/\r\n?/g, '\n');
  const blocks = [];
  for (const chunk of clean.split(/\n[ \t]*\n+/)) {
    const lines = chunk.split('\n').map((line) => line.replace(/\s+$/, ''));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) continue;
    const inl = [];
    lines.forEach((line, i) => {
      if (i) inl.push({ br: 1 });
      inl.push({ text: line.replace(/[ \t]+/g, ' ') });
    });
    blocks.push({ t: 'p', inl });
  }
  return blocks;
}
