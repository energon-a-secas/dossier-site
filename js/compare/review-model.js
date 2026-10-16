/**
 * The reviewer's own record: marks per criterion and column, notes, the
 * preferred report and a summary, as pure functions over a set. DOM-free:
 * node imports it.
 *
 * Dossier never scores a report. It keeps what the reviewer entered and
 * counts it ("2 strong, 1 weak"); there is no total, no average and no
 * ranking anywhere in here, on purpose.
 *
 * A verdict (a mark or the preferred report) records whether Blind was on
 * when it was entered (`blindAtVerdict`), so a review written with names
 * hidden says so after Reveal, and one changed afterwards with names showing
 * says that instead.
 */

import { LIMITS, MARKS, clampLine, clampText } from './model.js';

export const MARK_WORDS = Object.freeze({ strong: 'Strong', adequate: 'Adequate', weak: 'Weak', na: 'N/A' });

function withReview(set, patch) {
  return { ...set, review: { ...set.review, ...patch } };
}

/** A mark, or null to clear it. */
export function setMark(set, critId, colId, mark) {
  if (!set.review.criteria.some((c) => c.id === critId)) return set;
  if (!set.columns.some((c) => c.id === colId)) return set;
  const row = { ...(set.review.marks[critId] || {}) };
  if (MARKS.includes(mark)) row[colId] = mark;
  else delete row[colId];
  return withReview(set, {
    marks: { ...set.review.marks, [critId]: row },
    blindAtVerdict: Boolean(set.view.blind),
  });
}

/** The preferred report: a column id, 'none' (none is adequate) or null. */
export function setPreferred(set, value) {
  const ok = value === 'none' || value === null || set.columns.some((c) => c.id === value);
  if (!ok) return set;
  return withReview(set, { preferred: value, blindAtVerdict: Boolean(set.view.blind) });
}

export function setNote(set, colId, text) {
  if (!set.columns.some((c) => c.id === colId)) return set;
  const notes = { ...set.review.notes };
  const clean = clampText(text, LIMITS.note);
  if (clean) notes[colId] = clean;
  else delete notes[colId];
  return withReview(set, { notes });
}

export function setSummary(set, text) {
  return withReview(set, { summary: clampText(text, LIMITS.summary) });
}

/** A criterion id from its label, unique in the set. */
function criterionId(set, label) {
  const base = String(label || 'criterion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'criterion';
  const taken = new Set(set.review.criteria.map((c) => c.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`.slice(0, 40);
}

/** @returns {{set: object, id: string|null}} id is null at the limit */
export function addCriterion(set, label = 'New criterion') {
  if (set.review.criteria.length >= LIMITS.criteria) return { set, id: null };
  const clean = clampLine(label, LIMITS.criterion) || 'New criterion';
  const id = criterionId(set, clean);
  return { set: withReview(set, { criteria: [...set.review.criteria, { id, label: clean }] }), id };
}

export function renameCriterion(set, critId, label) {
  const clean = clampLine(label, LIMITS.criterion);
  if (!clean) return set;
  return withReview(set, { criteria: set.review.criteria.map((c) => (c.id === critId ? { ...c, label: clean } : c)) });
}

export function moveCriterion(set, critId, delta) {
  const list = [...set.review.criteria];
  const from = list.findIndex((c) => c.id === critId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return set;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return withReview(set, { criteria: list });
}

/** Remove a criterion and the marks under it. */
export function removeCriterion(set, critId) {
  const marks = { ...set.review.marks };
  delete marks[critId];
  return withReview(set, { criteria: set.review.criteria.filter((c) => c.id !== critId), marks });
}

// ── Reading the review ───────────────────────────────────────────────────────

/** How many of each mark a column has. */
export function tally(set, colId) {
  const counts = { strong: 0, adequate: 0, weak: 0, na: 0 };
  for (const crit of set.review.criteria) {
    const mark = set.review.marks[crit.id]?.[colId];
    if (mark) counts[mark] += 1;
  }
  return counts;
}

/** "2 strong, 2 adequate, 1 weak". Counts only. */
export function tallySentence(counts) {
  const parts = [];
  for (const mark of MARKS) {
    if (counts[mark]) parts.push(`${counts[mark]} ${mark === 'na' ? 'N/A' : mark}`);
  }
  return parts.length ? parts.join(', ') : 'No marks yet';
}

/** "A strong, B adequate, C strong", for a collapsed criterion. */
export function criterionSummary(set, crit, columns, refOf) {
  const parts = [];
  for (const col of columns) {
    const mark = set.review.marks[crit.id]?.[col.id];
    if (mark) parts.push(`${refOf(col)} ${mark === 'na' ? 'N/A' : mark}`);
  }
  return parts.length ? parts.join(', ') : 'Not marked';
}

/** Anything a verdict is made of has been entered. */
export function hasVerdict(set) {
  if (set.review.preferred) return true;
  return Object.values(set.review.marks || {}).some((row) => row && Object.keys(row).length);
}

/** The sentence under the review: how it was recorded. */
export function recordSentence(set) {
  if (!hasVerdict(set)) return 'Nothing recorded yet.';
  return set.review.blindAtVerdict
    ? 'Recorded while blind. Reveal shows names again; the review keeps this note.'
    : 'Recorded with labels visible.';
}

const cell = (text) => String(text || '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * The review as Markdown, in the order and with the names the view shows:
 * "Report 1" and report order while blind, letters and labels otherwise.
 *
 * @param {object} set
 * @param {Array<object>} columns in display order
 * @param {(col: object) => {mark: string, label: string, ref: string, role: string, blind: boolean}} nameOf
 */
export function reviewMarkdown(set, columns, nameOf) {
  const blind = Boolean(set.view.blind);
  const lines = [];
  lines.push(`# Review: ${blind ? 'Blind review' : set.title}`, '');
  lines.push(recordSentence(set), '');
  lines.push('Marks are the reviewer\'s own. Dossier counts them and does not score the reports.', '');
  lines.push('## Reports', '');
  for (const col of columns) {
    const name = nameOf(col);
    if (blind) lines.push(`- ${name.label}`);
    else lines.push(`- ${name.ref}: ${col.label} (${name.role}${col.author ? `, ${col.author}` : ''})`);
  }
  lines.push('');
  if (set.review.criteria.length) {
    lines.push('## Marks', '');
    lines.push(`| Criterion | ${columns.map((col) => cell(nameOf(col).ref)).join(' | ')} |`);
    lines.push(`|---|${columns.map(() => '---').join('|')}|`);
    for (const crit of set.review.criteria) {
      const row = columns.map((col) => {
        const mark = set.review.marks[crit.id]?.[col.id];
        return mark ? MARK_WORDS[mark] : '';
      });
      lines.push(`| ${cell(crit.label)} | ${row.join(' | ')} |`);
    }
    lines.push('');
    lines.push('## Counts', '');
    for (const col of columns) lines.push(`- ${nameOf(col).ref}: ${tallySentence(tally(set, col.id))}`);
    lines.push('');
  }
  lines.push('## Preferred', '');
  const pref = set.review.preferred;
  if (pref === 'none') lines.push('None is adequate.');
  else if (pref) {
    const col = columns.find((c) => c.id === pref);
    lines.push(col ? (blind ? nameOf(col).label : `${nameOf(col).ref}: ${col.label}`) : 'Not chosen.');
  } else lines.push('Not chosen.');
  lines.push('');
  const notes = columns.filter((col) => set.review.notes[col.id]);
  if (notes.length) {
    lines.push('## Notes', '');
    for (const col of notes) {
      lines.push(`### ${blind ? nameOf(col).label : `${nameOf(col).ref}: ${col.label}`}`, '', set.review.notes[col.id].trim(), '');
    }
  }
  if (set.review.summary.trim()) lines.push('## Summary', '', set.review.summary.trim(), '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
