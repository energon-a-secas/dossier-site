/**
 * What the differences add to each column: the line in its head ("15
 * differences from B" and its parts, or why it is not compared), the notes
 * over its text, its marks, and the part of its body's key they decide.
 * Part of js/compare/analysis.js.
 *
 * Each column names its own reference, the column it is marked against
 * (js/compare/model.js `diffAgainst`): with "Each against its source" the
 * Fixes column reads "14 differences from B" while the Agent column reads
 * "differences from A".
 */

import { escHtml } from '../neorgon-dom.js';
import { columnMarks, countsSentence, baseName } from './marks.js';
import { columnEl } from './view.js';
import { icon } from './icons.js';
import { columnById } from './model.js';
import { sourceId } from './plans.js';
import { numberChanges } from './numbers.js';

/**
 * A column notice naming the reference, as js/compare/column.js `note`
 * draws one. `html` is our own markup; the reference's name goes in through
 * `baseName`, escaped there and renamed in place (`relabel`).
 */
function baseNote(html) {
  return `<p class="col-note">${icon('info')}<span>${html}</span></p>`;
}

/**
 * The notice of a column too different to mark word by word. Its last
 * sentence points at the Word marks button, which the one-file export
 * does not carry, so it is a span of its own that the export leaves out
 * (js/compare/export.js `readerCopy`).
 */
function barsNote(baseRef, numbers) {
  return baseNote(`<b>Too different from ${baseName(baseRef)} to mark word by word.</b> `
    + 'Margin bars show where it differs, and its sections still line up. '
    + `${numbers ? 'Numbers that changed are still marked. ' : ''}`
    + '<span class="col-note__live">Turn on Word marks to see every word anyway.</span>');
}

/** The notice of a column with changed parts left without word marks. */
function unmarkedNote(n, forced) {
  const parts = `${n} changed part${n === 1 ? ' is' : 's are'} not marked word by word`;
  return baseNote(forced
    ? `<b>${parts}</b> (too many edits), even with Word marks on. ${n === 1 ? 'It is' : 'They are'} tinted only.`
    : `<b>${parts}</b> (too many edits). ${n === 1 ? 'It is' : 'They are'} tinted only. `
      + '<span class="col-note__live">Turn on Word marks to try harder.</span>');
}

/**
 * @param {{compare: object, plans: object, refOf: (colId: string) => string}} ctx
 */
export function createDiffHeads({ compare, plans, refOf }) {
  const {
    planFor, baseId, refFor, isEach,
  } = plans;

  function bodyHooks(col) {
    const plan = planFor(col);
    // A column in Original or running its scripts says why it is not marked
    // in its head's difference line, once (`headInfo`), not again here.
    if (!plan?.result) return {};
    const baseRef = refOf(plan.ref);
    if (plan.result.failed === 'budget') {
      return { notes: baseNote(`<b>Too long to compare part by part with ${baseName(baseRef)} here.</b> Its sections still line up in the Sections panel.`) };
    }
    if (plan.result.failed) {
      return { notes: baseNote(`<b>Too different from ${baseName(baseRef)} to compare part by part.</b> Its sections still line up in the Sections panel.`) };
    }
    if (plan.counted) {
      return { notes: baseNote(`Differences from ${baseName(baseRef)} are counted above, not marked in the text: this column holds a Dossier document.`) };
    }
    const hooks = { marks: columnMarks(plan.result, { colId: col.id, baseRef, bars: plan.bars }) };
    if (plan.bars) hooks.notes = barsNote(baseRef, numberChanges(plan.result).length > 0);
    else if (plan.result.unmarked > 0) hooks.notes = unmarkedNote(plan.result.unmarked, plan.forced);
    return hooks;
  }

  /**
   * Name each column's reference as it is named now everywhere its text
   * names it. The name is not part of a body's key (`bodyKeyExtra`): Blind
   * and a move rename a column without changing a mark, and a body drawn
   * again starts at its top and drops focus, which with Sync off nothing
   * put back.
   */
  function relabel() {
    const set = compare.set;
    for (const col of set?.columns || []) {
      const el = columnEl(compare.refs, col.id);
      if (!el) continue;
      const ref = refFor(col, set);
      const name = ref ? refOf(ref) : '';
      for (const span of el.querySelectorAll('[data-base-ref]')) {
        if (span.textContent !== name) span.textContent = name;
      }
    }
  }

  function bodyKeyExtra(col) {
    const set = compare.set;
    const plan = planFor(col);
    // An Original or interactive column's body does not change with the
    // differences, so toggling them never reloads its frame.
    if (!plan || plan.base || plan.off) return '';
    if (plan.pending) return '|dp';
    if (plan.unreadable) return `|du:${plan.unreadable}`;
    const d = set.view.diff;
    // The reference's name is left out on purpose: `relabel` keeps it current.
    return `|d:${plan.ref}:${sourceId(columnById(set, plan.ref)?.source)}:${d.ignoreCase ? 1 : 0}${d.ignorePunctuation ? 1 : 0}`
      + `:${plan.bars ? 'b' : 'w'}${plan.forced ? 'f' : ''}`;
  }

  function headInfo(col, record) {
    const set = compare.set;
    if (!col.source) return {};
    if (!set.view.diff.on) return { diffLine: '<span>Differences are off.</span>' };
    const base = baseId(set);
    if (!base) return {};
    if (col.id === base) {
      let diffLine = '<span>Base for differences. Other columns are marked against this one.</span>';
      if (planFor(col, record)?.unreadable) {
        diffLine = '<span>Base for differences, but it could not be read, so no column is marked. Choose another base in Differences against.</span>';
      } else if (isEach(set)) {
        diffLine = '<span>Base for differences. A fix is marked against the column it fixes, every other column against this one.</span>';
      }
      return { isBase: true, diffLine };
    }
    const plan = planFor(col, record);
    const ref = plan?.ref ?? refFor(col, set);
    if (!ref) return {};
    const name = escHtml(refOf(ref));
    const info = { baseStats: compare.ui.records.get(ref)?.stats || null, baseLetter: refOf(ref) };
    if (!plan) return info;
    if (plan.off === 'scripts') info.diffLine = '<span>Differences are off for a column that runs its scripts.</span>';
    else if (plan.off) info.diffLine = '<span>Differences show in Dossier format.</span>';
    else if (plan.unreadable === 'column') info.diffLine = '<span>Not compared: this Dossier document could not be read.</span>';
    else if (plan.unreadable) {
      info.diffLine = ref === base
        ? `<span>Not compared: ${name}, the base, could not be read.</span>`
        : `<span>Not compared: ${name} could not be read.</span>`;
    } else if (plan.pending) info.diffLine = `<span>Counting differences from ${name}.</span>`;
    else if (plan.result.failed === 'budget') info.diffLine = `<span>Too long to compare part by part with ${name} here.</span>`;
    else if (plan.result.failed) info.diffLine = `<span>Too different from ${name} to compare.</span>`;
    else info.diffLine = diffLine(col, plan, name);
    return info;
  }

  /**
   * "15 differences from B" and what they are: "6 changed, 6 added, 3
   * removed, 1 moved". Where the column is marked word by word, each part is
   * drawn the way its marks are (a changed tint, an inserted word, a struck
   * one), so the parts are the key as well (design spec 7.3.4). Then the
   * numbers that changed, if any, and Word marks where some text is not
   * marked word by word.
   */
  function diffLine(col, plan, name) {
    const { counts } = plan.result;
    const total = counts.total;
    const words = total
      ? `<b>${total}</b> difference${total === 1 ? '' : 's'} from ${name}`
      : `No differences from ${name}`;
    const count = `<span class="col__count" title="${escHtml(countsSentence(counts))}">${words}</span>`;
    const parts = [['k-chg', counts.changed, 'changed'], ['k-ins', counts.added, 'added'], ['k-del', counts.removed, 'removed'], ['k-mov', counts.moved, 'moved']]
      .filter(([, n]) => n)
      .map(([cls, n, word]) => `<span class="${cls}">${n} ${word}</span>`);
    const keyed = !plan.counted && !plan.bars;
    const key = parts.length
      ? `<span class="key${keyed ? '' : ' key--plain'}"><span class="visually-hidden">: </span>${parts.join('<span class="visually-hidden">, </span>')}</span>`
      : '';
    const k = numberChanges(plan.result).length;
    const numbers = k
      ? `<button type="button" class="btn btn--xs col__nums" data-action="cmp-numbers" data-col="${col.id}" aria-haspopup="dialog"`
        + ` aria-expanded="false" aria-controls="cmpNumbers">${k} number${k === 1 ? '' : 's'} changed</button>`
      : '';
    const wanted = plan.forced || plan.result.tooDifferent || plan.result.unmarked > 0;
    const toggle = wanted && !plan.counted
      ? `<button type="button" class="btn btn--xs toggle col__words" data-action="cmp-word-marks" data-col="${col.id}"`
        + ` aria-pressed="${plan.forced}"><span class="box">${icon('check')}</span>Word marks</button>`
      : '';
    return `${count}${key}${numbers}${toggle}`;
  }

  return {
    bodyHooks, bodyKeyExtra, headInfo, relabel,
  };
}
