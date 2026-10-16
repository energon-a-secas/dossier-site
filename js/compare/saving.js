/**
 * Saving the open comparison: the save timer, the write, other tabs, and
 * the page-hide journal. Split out of js/compare/index.js, which owns what
 * is open and how it is drawn; this owns how it reaches IndexedDB.
 *
 * Three rules, each from a way an edit was lost:
 *
 * - Writes run one after another, and each says which stored revision it
 *   was made on (`writeSet`'s `expect`). When another tab saved the set in
 *   between, the two versions are merged key by key (js/compare/merge.js)
 *   and the merge is saved. A tab that heard another tab's save while a save
 *   of its own was waiting used to ignore it and then write over it.
 * - Before the open set changes, the view is left or the page hides, every
 *   edit still waiting (a note being typed) lands in the set it was typed in
 *   (`compare.hooks.beforeSwitch`). A note typed just before Back used to land
 *   in the comparison opened next.
 * - A write started as the page unloads never commits, so a change not yet
 *   saved when the page hides also goes into a synchronous journal
 *   (js/compare/journal.js), replayed before the next visit opens a set.
 */

import { say } from '../share.js';
import { filledColumns } from './model.js';
import {
  readSet, readSetRecord, writeSet, TAB_ID,
} from './store.js';
import { mergeSets } from './merge.js';
import {
  makeJournal, saveJournal, takeJournal, replayJournal, clearJournal,
} from './journal.js';

const SAVE_DELAY_MS = 400;

/**
 * @param {{compare: object, render: Function, rememberScroll: Function,
 *   remember: (id: string) => void, syncAddress: Function}} deps
 */
export function createSaving({
  compare, render, rememberScroll, remember, syncAddress,
}) {
  let warnedSave = false;
  /** The revision each set was left at by this tab's last write of it. */
  const lastRev = new Map();

  /**
   * A save waits a moment for the next keystroke; `flush` saves now and
   * resolves once the write (or the one already under way) has landed.
   * `dirty` is true from a change until a write of it lands with no newer
   * change behind it: what the page-hide journal looks at.
   */
  const save = (() => {
    let timer = 0;
    let writing = Promise.resolve();
    let edits = 0;
    let unsaved = false;
    let columns = false;
    const run = () => {
      clearTimeout(timer);
      timer = 0;
      const token = edits;
      // Which set to write is decided now: by the time the write's turn
      // comes, another set may be open (a flush on the way to it).
      const job = {
        set: compare.set, saved: compare.saved, example: compare.example, rev: compare.rev,
      };
      writing = writing.then(() => persistNow(job)).catch(() => false).then((ok) => {
        if (ok && edits === token) {
          unsaved = false;
          columns = false;
        }
        return ok;
      });
      return writing;
    };
    const schedule = ({ columns: touched = false } = {}) => {
      edits += 1;
      unsaved = true;
      if (touched) columns = true;
      clearTimeout(timer);
      timer = setTimeout(run, SAVE_DELAY_MS);
    };
    schedule.pending = () => Boolean(timer);
    schedule.dirty = () => unsaved;
    schedule.touchedColumns = () => columns;
    schedule.flush = () => (timer ? run() : writing);
    /** Write now, waiting or not (an explicit save). */
    schedule.now = () => run();
    return schedule;
  })();

  /**
   * Write a set. While it is still the open one, its newest state is written
   * (edits made since the job was queued included); once another set is
   * open, the set as it was when the job was queued.
   *
   * @param {{set: object, saved: boolean, example: boolean, rev?: number}} job
   * @returns {Promise<boolean>} true when nothing is left to save
   */
  async function persistNow(job, retried = false) {
    if (!job?.set) return true;
    const open = compare.set?.id === job.set.id;
    const set = open ? compare.set : job.set;
    const saved = open ? compare.saved : job.saved || lastRev.has(set.id);
    if (open ? compare.example : job.example) return true;
    if (!saved && !filledColumns(set).length) return true;
    const rev = open ? compare.rev : (lastRev.has(set.id) ? lastRev.get(set.id) : job.rev);
    const written = await writeSet(set, { expect: saved ? rev : undefined });
    if (!written) {
      if (!warnedSave) {
        warnedSave = true;
        say('This comparison could not be saved in this browser, so it stays open only until the tab closes.');
      }
      return false;
    }
    if (written.conflict) {
      // Another tab saved this set since this one last read it. Both edits
      // are kept: merged key by key, then saved over the version there.
      const current = written.current;
      lastRev.set(set.id, current.updated);
      const stillOpen = compare.set?.id === set.id;
      const merged = mergeSets(stillOpen ? compare.base : null, stillOpen ? compare.set : set, current) || current;
      if (stillOpen) {
        rememberScroll();
        compare.set = merged;
        compare.base = current;
        compare.rev = current.updated;
        render();
      }
      return retried ? false : persistNow({ set: merged, saved: true, example: false, rev: current.updated }, true);
    }
    lastRev.set(written.id, written.updated);
    // A write that works again after a failure warns again on the next one.
    warnedSave = false;
    clearJournal(written.id);
    if (compare.set?.id !== written.id) return true;
    compare.base = written;
    compare.rev = written.updated;
    const first = !compare.saved;
    compare.saved = true;
    remember(written.id);
    if (first) syncAddress();
    return true;
  }

  /** Land every edit still waiting (a note being typed) in the open set. */
  function flushPending() {
    for (const fn of compare.hooks.beforeSwitch || []) {
      try {
        fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('An edit could not be flushed', err);
      }
    }
  }

  /** An edit is waiting that is not in the set yet, or not saved yet. */
  function hasPendingEdits() {
    return save.dirty() || (compare.hooks.pending || []).some((fn) => {
      try {
        return Boolean(fn());
      } catch {
        return false;
      }
    });
  }

  /**
   * The page is hiding, and may be about to unload. Edits still waiting land
   * in the set; a change not yet saved goes into the journal, synchronously,
   * because the write started next is dropped if the page unloads; then the
   * write starts, and when it lands it removes the journal again.
   */
  function onHide() {
    flushPending();
    const set = compare.set;
    if (set && !compare.example && save.dirty() && (compare.saved || filledColumns(set).length)) {
      saveJournal(makeJournal(set, {
        base: compare.saved ? compare.rev : undefined,
        writer: TAB_ID,
        withColumns: save.touchedColumns() || !compare.saved,
      }));
    }
    save.flush();
  }

  let replayed = null;

  /** Replay a journal left by the last visit, once, before any set is read. */
  function replayOnce() {
    if (!replayed) {
      replayed = (async () => {
        const journal = takeJournal();
        if (!journal) return;
        const next = replayJournal(journal, await readSetRecord(journal.id));
        if (next) await writeSet(next);
      })().catch(() => {});
    }
    return replayed;
  }

  /**
   * Another tab saved this set. With nothing of this tab's waiting, its
   * version is taken as it is. With an edit waiting (or being written), the
   * two are merged, and the merge is what this tab saves next.
   */
  async function tookOtherTabsWrite() {
    const set = compare.set;
    const fresh = set ? await readSet(set.id) : null;
    if (!fresh || compare.set?.id !== fresh.id || fresh.updated === compare.rev) return;
    rememberScroll();
    compare.set = hasPendingEdits() ? (mergeSets(compare.base, compare.set, fresh) || fresh) : fresh;
    compare.base = fresh;
    compare.rev = fresh.updated;
    render();
  }

  return {
    save, persistNow, flushPending, hasPendingEdits, onHide, replayOnce, tookOtherTabsWrite,
  };
}
