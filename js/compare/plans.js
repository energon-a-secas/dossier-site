/**
 * What the differences mean for each column of a comparison: which column
 * is the base, what each column is marked against (its reference: the base,
 * or with "Each against its source" the column a fix corrects, see
 * js/compare/model.js `diffAgainst`), each column's IR, and the plan for
 * each column (the base, not compared and why, still waiting for a drawn
 * document, or a diff result and how it is marked). Part of
 * js/compare/analysis.js.
 *
 * Word marks turned on by hand ask the diff for more (`force`: higher caps,
 * more work), so the toggle marks units the default leaves unmarked rather
 * than only switching margin bars off.
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
import { columnById, diffAgainst } from './model.js';

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
  /** The root column: the one with the Base tag, the one the Sections rows follow. */
  function baseId(set = compare.set) {
    return set ? diffAgainst(set).base : null;
  }

  /** The column `col` is marked against, or null (the base, or no report). */
  function refFor(col, set = compare.set) {
    return set && col ? diffAgainst(set).against.get(col.id) ?? null : null;
  }

  /** True when each column is marked against its own source. */
  function isEach(set = compare.set) {
    return Boolean(set && diffAgainst(set).each);
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
   * @returns {null | {base: true, unreadable?: true} | {off: 'mode'|'scripts', ref: string}
   *   | {pending: true, ref: string} | {unreadable: 'base'|'column', ref: string}
   *   | {result: object, bars: boolean, forced: boolean, counted: boolean, ref: string}}
   *   `ref` is the column it is marked against. `counted`: a Dossier
   *   document, counted and not marked. `unreadable`: a Dossier document
   *   that could not be read, this column's or its reference's, so it is
   *   left out of the differences. It used to read as pending for good, and
   *   the view redrew itself every frame waiting for it.
   */
  function planFor(col, record = null, set = compare.set) {
    if (!set || !col?.source || !set.view.diff.on) return null;
    const base = baseId(set);
    if (!base) return null;
    if (col.id === base) return irOf(col, record) === false ? { base: true, unreadable: true } : { base: true };
    const ref = refFor(col, set);
    if (!ref) return null;
    const mode = effectiveMode(set, col);
    if (mode === 'interactive') return { off: 'scripts', ref };
    if (mode !== 'format') return { off: 'mode', ref };
    const blocks = irOf(col, record);
    if (blocks === false) return { unreadable: 'column', ref };
    const refBlocks = irOf(columnById(set, ref));
    if (refBlocks === false) return { unreadable: 'base', ref };
    if (!refBlocks || !blocks) return { pending: true, ref };
    const forced = wordMarks.has(`${set.id}:${col.id}`);
    const result = diffBlocks(refBlocks, blocks, { ...set.view.diff, force: forced });
    return {
      result,
      bars: result.tooDifferent && !forced,
      forced,
      counted: col.source.kind === 'dossier',
      ref,
    };
  }

  return {
    baseId, refFor, isEach, planFor, irOf,
  };
}
