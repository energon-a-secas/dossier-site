/**
 * Dossier field types: the small language every registry entry is written in.
 *
 * One vocabulary, five readers. The validator checks a document against it,
 * the renderer trusts it, the catalog builds a form from it, schema.json is
 * generated from it, and llms.txt's table is printed from it. The sibling
 * project keeps the same facts in five hand-written places and three of them
 * are stale, which is the whole reason this file exists.
 *
 * DOM-free on purpose: Node imports this, so the CLI, the tests and the
 * browser cannot disagree about what a valid document is.
 */

/** Every type a field may declare. */
export const TYPES = Object.freeze([
  'string',   // one line, no markup
  'text',     // prose, the inline markdown subset
  'number',
  'integer',
  'boolean',
  'enum',     // + values: []
  'url',      // http(s) or a relative path; never javascript:
  'date',     // YYYY-MM-DD or an ISO instant
  'array',    // + of: <type descriptor>
  'object',   // + fields: { name: <descriptor> }
  'any',      // a table cell, deliberately unconstrained
]);

/**
 * A field descriptor:
 *   { type, required?, values?, of?, fields?, min?, max?, maxLen?, note?,
 *     derived?, accepts? }
 *
 *   derived  this field is computed when absent; never ask a model for it
 *   accepts  alternative spellings coerced on input, recorded as a note
 */
export function field(type, opts = {}) {
  return { type, ...opts };
}

export const str = (o) => field('string', o);
export const text = (o) => field('text', o);
export const num = (o) => field('number', o);
export const int = (o) => field('integer', o);
export const bool = (o) => field('boolean', o);
export const url = (o) => field('url', o);
export const date = (o) => field('date', o);
export const enom = (values, o = {}) => field('enum', { values, ...o });
export const arr = (of, o = {}) => field('array', { of, ...o });
export const obj = (fields, o = {}) => field('object', { fields, ...o });

/** Tones are one closed set across every block, so a colour means one thing. */
export const TONES = Object.freeze(['neutral', 'good', 'bad', 'warn', 'info']);

/** Where a block sits when its page flows into a grid. */
export const WIDTHS = Object.freeze(['full', 'half', 'third', 'two-thirds']);

/**
 * Who established a piece of evidence. Borrowed from OpenInference's
 * annotator_kind, which splits exactly where a reviewer's trust splits.
 *
 * `code` is a machine check that either passed or did not: a test run, a
 * linter, a byte comparison. `llm` is a model's own assertion, which is a
 * claim however confidently it is phrased. `human` is someone who looked.
 * `none` is explicit and honest, and the linter prefers it to an omission.
 */
export const CHECKED_BY = Object.freeze(['code', 'human', 'llm', 'none']);

/**
 * The envelope every block carries, checked before the block's own fields.
 * `evidence` is here rather than on the blocks that "need" it because the
 * reader's question is the same everywhere: how do you know?
 */
export const ENVELOPE = Object.freeze({
  type: str({ required: true }),
  id: str({ note: 'Anchor for deep links. Derived from the title when absent.', derived: true }),
  title: str({ maxLen: 90 }),
  note: text({ maxLen: 400, note: 'A caption under the block, not a footnote.' }),
  width: enom(WIDTHS, { note: 'Ignored outside a grid.' }),
  tone: enom(TONES),
  collapsed: bool({ note: 'Render folded. The reader can always open it.' }),
  extra: obj({}, {
    note: 'Your own fields. Carried through every export and never rendered, so a team can extend the format without forking it.',
  }),
  evidence: arr(
    obj({
      label: str({ required: true }),
      href: url(),
      hash: str({ note: 'A digest of the artefact, so a reader can tell it is the same one.' }),
      excerpt: text({ maxLen: 800 }),
      kind: enom(['commit', 'file', 'log', 'test', 'run', 'ticket', 'doc', 'metric', 'other']),
      checkedBy: enom(CHECKED_BY, {
        note: 'Who established this. The reader\'s real question is not whether it is true but who checked it, and whether that was a machine.',
      }),
      confidence: enom(['high', 'medium', 'low']),
    }),
    { note: 'How the reader can check this block without trusting the author.' },
  ),
});

/** Document-level fields. */
export const KINDS = Object.freeze([
  'fix', 'audit', 'migration', 'performance',
  'incident', 'summary', 'comparison', 'release',
]);

export const STATUSES = Object.freeze([
  'draft', 'in-review', 'shipped', 'blocked', 'rolled-back',
]);

export const META = Object.freeze({
  version: int({ required: true, note: 'Always 1 today. Bumped only on a breaking change.' }),
  title: str({ required: true, maxLen: 120 }),
  subtitle: str({ maxLen: 160, note: 'One sentence a reviewer can repeat.' }),
  kind: enom(KINDS),
  status: enom(STATUSES),
  owner: str({ maxLen: 80 }),
  period: obj({ from: date(), to: date() }),
  source: obj({
    repo: str(), branch: str(), commit: str(), href: url(),
  }),
  tags: arr(str(), { max: 12 }),
  chrome: enom(['auto', 'hidden', 'shown'], {
    note: 'auto hides the header when the report arrived in the URL.',
  }),
  pages: arr('page', { required: true, min: 1, max: 40 }),
});

export const PAGE = Object.freeze({
  id: str({ derived: true }),
  title: str({ required: true, maxLen: 60 }),
  summary: str({ maxLen: 200, note: 'Shown under the page tab, not in the body.' }),
  blocks: arr('block', { required: true, min: 1 }),
});
