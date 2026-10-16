/**
 * Words and punctuation of a report's text, for the word diff
 * (js/compare/diff-words.js). DOM-free: node imports it.
 *
 * Tokens of inline runs carry the wrappers they sit in (bold, a link), so a
 * marked unit is rebuilt with its own formatting around the marks.
 */

/**
 * A word keeps its inner joiners ("1,940", "2.9", "14:04", "cart-api",
 * "don't"), a currency sign before a number and a percent sign after one
 * ("$40", "6.2%"); whitespace collapses to one token; any other character
 * is punctuation on its own.
 */
const TOKEN = /((?:[$€£¥](?=\p{N}))?[\p{L}\p{N}\p{M}]+(?:[.,:'’ʼ\-/_][\p{L}\p{N}\p{M}]+)*%?)|(\s+)|([^\s])/gu;
const QUOTES = /[‘’‚‛ʼ′]/g;
const DQUOTES = /[“”„‟″«»]/g;

/**
 * @param {{ignoreCase?: boolean, ignorePunctuation?: boolean}} opts
 * @returns {(text: string) => string} the comparison key of a word
 */
export function wordKey(opts) {
  return (text) => {
    let key = text.normalize('NFC');
    if (opts.ignoreCase) key = key.toLowerCase();
    if (opts.ignorePunctuation) key = key.replace(QUOTES, "'").replace(DQUOTES, '"');
    return key;
  };
}

/**
 * Split plain text into tokens, each `{text, kind}` with kind `w` (word),
 * `s` (whitespace) or `p` (punctuation).
 */
export function tokenize(text) {
  const out = [];
  for (const match of String(text || '').matchAll(TOKEN)) {
    if (match[1]) out.push({ text: match[1], kind: 'w' });
    else if (match[2]) out.push({ text: ' ', kind: 's' });
    else out.push({ text: match[3], kind: 'p' });
  }
  return out;
}

/**
 * Tokens of inline runs, each carrying the wrappers it sits in (`ctx`, an
 * array shared by every token of one run, so equal wrappers compare by
 * identity) and, for code, the run it came from.
 */
export function inlineTokens(inl) {
  const out = [];
  const walk = (runs, ctx) => {
    for (const run of Array.isArray(runs) ? runs : []) {
      if (!run || typeof run !== 'object') continue;
      if (typeof run.text === 'string') {
        for (const tok of tokenize(run.text)) out.push({ ...tok, ctx });
      } else if (typeof run.code === 'string') {
        for (const tok of tokenize(run.code)) out.push({ ...tok, ctx, code: run });
      } else if (run.br) {
        out.push({ text: ' ', kind: 's', ctx, br: true });
      } else {
        for (const key of ['b', 'i', 'sub', 'sup', 'mark', 'a']) {
          if (!Array.isArray(run[key])) continue;
          const desc = { key };
          if (key === 'a') {
            if (typeof run.href === 'string') desc.href = run.href;
            if (Number.isInteger(run.local)) desc.local = run.local;
          }
          walk(run[key], [...ctx, desc]);
          break;
        }
      }
    }
  };
  walk(inl, []);
  return out;
}

/** Wrappers of a deleted token: a link from the other report would point nowhere here. */
const unlinked = new WeakMap();
export function withoutLinks(ctx) {
  if (!ctx.some((d) => d.key === 'a')) return ctx;
  if (!unlinked.has(ctx)) unlinked.set(ctx, ctx.filter((d) => d.key !== 'a'));
  return unlinked.get(ctx);
}

/**
 * Rebuild inline runs from tokens: adjacent tokens under the same wrappers
 * share them again, and a code run split by nothing stays one code run.
 */
export function tokensToInline(tokens) {
  const root = [];
  let stack = [];
  for (const tok of tokens) {
    const ctx = tok.ctx || [];
    let depth = 0;
    while (depth < stack.length && depth < ctx.length && stack[depth].desc === ctx[depth]) depth += 1;
    stack = stack.slice(0, depth);
    let arr = depth ? stack[depth - 1].arr : root;
    for (let j = depth; j < ctx.length; j += 1) {
      const desc = ctx[j];
      const run = { [desc.key]: [] };
      if (desc.href) run.href = desc.href;
      if (desc.local) run.local = desc.local;
      arr.push(run);
      arr = run[desc.key];
      stack.push({ desc, arr });
    }
    const last = arr[arr.length - 1];
    if (tok.br) {
      arr.push({ br: 1 });
    } else if (tok.code) {
      if (last && typeof last.code === 'string' && last.from === tok.code) last.code += tok.text;
      else arr.push(Object.defineProperty({ code: tok.text }, 'from', { value: tok.code }));
    } else if (last && typeof last.text === 'string') {
      last.text += tok.text;
    } else {
      arr.push({ text: tok.text });
    }
  }
  return root;
}

