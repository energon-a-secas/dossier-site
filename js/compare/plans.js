/**
 * What the differences mean for each column of a comparison: which column
 * is the base, each column's IR, and the plan for each column (the base,
 * not compared and why, still waiting for a drawn document, or a diff
 * result and how it is marked). Part of js/compare/analysis.js.
 *
 * A Dossier document's IR comes from its drawn record, so it is unknown
 * until the column is drawn; one that cannot be read is known to be
 * unreadable from then on, and is left out of the differences with a
 * notice rather than waited for.
 */

import { htmlToIr } from './normalize.js';
import { markdownToIr } from './markdown-ir.js';
import { textToIr } from './ir.js';
import { diffBlocks } from './diff.js';
import { effectiveMode } from './column.js';
import { columnById, defaultBase } from './model.js';

const irs = new WeakMap();
const sourceIds = new WeakMap();
let sourceSeq = 0;

/** A stable small id per source object, for redraw keys. */
export function sourceId(source) {
  if (!source) return 'none';
  if (!sourceIds.has(source)) {
    sourceSeq += 1;
    sourceIds.set(source, sourceSeq);
  }
  return sourceIds.get(source);
}

/**
 * @param {object} compare the view's state (js/compare/index.js)
 * @param {Set<string>} wordMarks columns whose Word marks are on: `${setId}:${colId}`
 */
export function createPlans(compare, wordMarks) {
  /** The column every other is marked against. */
  function baseId(set = compare.set) {
    if (!set) return null;
    const chosen = set.view.diff.base;
    if (chosen && columnById(set, chosen)?.source) return chosen;
    const fallback = defaultBase(set);
    return fallback && columnById(set, fallback)?.source ? fallback : null;
  }

  /**
   * A column's IR. A Dossier document's comes from its drawn record: null
   * until it is drawn, false once drawn when it could not be read (a record
   * of kind "error"), which no later draw changes until its source does.
   */
  function irOf(col, record = null) {
    const source = col?.source;
    if (!source) return null;
    if (source.kind === 'dossier') {
      const rec = record || compare.ui.records.get(col.id);
      if (!rec) return null;
      return rec.kind === 'reader' && Array.isArray(rec.blocks) ? rec.blocks : false;
    }
    if (!irs.has(source)) {
      let blocks = [];
      if (source.kind === 'html') blocks = htmlToIr(source.text).blocks;
      else if (source.kind === 'markdown') blocks = markdownToIr(source.text).blocks;
      else blocks = textToIr(source.text);
      irs.set(source, blocks);
    }
    return irs.get(source);
  }

  /**
   * What the differences mean for one column.
   *
   * @returns {null | {base: true, unreadable?: true} | {off: 'mode'|'scripts'}
   *   | {pending: true} | {unreadable: 'base'|'column'}
   *   | {result: object, bars: boolean, forced: boolean, counted: boolean}}
   *   `counted`: a Dossier document, counted and not marked. `unreadable`: a
   *   Dossier document that could not be read, this column's or the base's,
   *   so it is left out of the differences. It used to read as pending for
   *   good, and the view redrew itself every frame waiting for it.
   */
  function planFor(col, record = null, set = compare.set) {
    if (!set || !col?.source || !set.view.diff.on) return null;
    const base = baseId(set);
    if (!base) return null;
    if (col.id === base) return irOf(col, record) === false ? { base: true, unreadable: true } : { base: true };
    const mode = effectiveMode(set, col);
    if (mode === 'interactive') return { off: 'scripts' };
    if (mode !== 'format') return { off: 'mode' };
    const blocks = irOf(col, record);
    if (blocks === false) return { unreadable: 'column' };
    const baseBlocks = irOf(columnById(set, base));
    if (baseBlocks === false) return { unreadable: 'base' };
    if (!baseBlocks || !blocks) return { pending: true };
    const result = diffBlocks(baseBlocks, blocks, set.view.diff);
    const forced = wordMarks.has(`${set.id}:${col.id}`);
    return {
      result,
      bars: result.tooDifferent && !forced,
      forced,
      counted: col.source.kind === 'dossier',
    };
  }

  return { baseId, planFor };
}
