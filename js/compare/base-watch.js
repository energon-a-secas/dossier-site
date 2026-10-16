/**
 * Say when what the differences are marked against changes on its own, with
 * an Undo. Part of js/compare/analysis.js.
 *
 * With no base chosen, the choice follows the reports (js/compare/model.js
 * `diffAgainst`): a Fixes column getting its report turns on "Each against
 * its source", the first report put in column A takes the base from B. That
 * used to happen with no word, while the marks of a column the reader was
 * looking at changed meaning. Now every such change is said, and Undo keeps
 * the choice from before, chosen explicitly. A base the reader chose never
 * moves on its own, opening or replacing a comparison is not a change, and
 * adding or removing a column says so itself.
 *
 * The sentence goes in the undo toast after the action that caused it has
 * said its own; an action that put up an undo toast of its own keeps it,
 * and the sentence goes in the status toast instead.
 */

import { say } from '../share.js';
import { undoToast } from './popover.js';
import { setView, diffAgainst, EACH } from './model.js';

/** The choice in force: EACH or a column id. */
const choiceOf = (set) => {
  const d = diffAgainst(set);
  return d.each ? EACH : d.base;
};

/** What every column with a report is marked against, as one comparable string. */
const meaning = (set) => JSON.stringify([...diffAgainst(set).against]);

/**
 * @param {object} api from js/compare/index.js
 * @param {(colId: string) => string} refOf a column's name as shown (Blind aware)
 */
export function watchBase(api, refOf) {
  const { compare } = api;
  const host = compare.refs.toast;

  function sentence(next, now) {
    const d = diffAgainst(next);
    const fix = next.columns.find((col) => col.role === 'fix' && col.source && d.against.get(col.id) === col.fixes && col.fixes !== d.base);
    if (now === EACH) {
      return fix
        ? `Differences are now marked against each column's source: ${refOf(fix.id)} against ${refOf(fix.fixes)}, the column it fixes, and the rest against ${refOf(d.base)}.`
        : 'Differences are now marked against each column\'s source.';
    }
    const fixer = next.columns.find((col) => col.role === 'fix' && col.source && col.fixes === now);
    return fixer
      ? `Differences are now marked against ${refOf(now)}, the column ${refOf(fixer.id)} fixes.`
      : `Differences are now marked against ${refOf(now)}.`;
  }

  compare.hooks.afterCommit.push((before, next) => {
    if (!before || !next || before.id !== next.id || !next.view.diff.on || next.view.diff.base) return;
    const ids = (set) => set.columns.map((col) => col.id).join(' ');
    if (ids(before) !== ids(next)) return;
    const was = choiceOf(before);
    const now = choiceOf(next);
    if (!was || !now || was === now) return;
    // Nothing to say when keeping the old choice would mark every column the same way.
    if (meaning(next) === meaning(setView(next, { diff: { base: was } }))) return;
    const message = sentence(next, now);
    const shownBefore = host?.textContent || '';
    queueMicrotask(() => {
      if (host?.classList.contains('is-visible') && host.textContent !== shownBefore) {
        say(message);
        return;
      }
      undoToast(host, message, () => {
        if (compare.set?.id === next.id) api.commit(setView(compare.set, { diff: { base: was } }));
        return () => document.getElementById('cmpAgainst');
      });
    });
  });
}
