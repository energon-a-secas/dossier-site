/**
 * Result blocks: findings and tests.
 *
 * These two exist because they recur in every tool that reports on code, and
 * because each one already has a widely emitted machine format behind it. A
 * findings block is shaped like a SARIF result and like a GitHub Checks
 * annotation, which agree with each other: a path, a line span, a level and a
 * message. A tests block is shaped like the stable subset of JUnit XML and
 * like CTRF. An adapter for each is a short file rather than a translation.
 */

import { str, text, num, int, bool, url, enom, arr, obj } from './types.js';

/** SARIF calls these levels; GitHub Checks calls them annotation_level. */
export const FINDING_LEVELS = Object.freeze(['error', 'warning', 'note']);
export const TEST_STATES = Object.freeze(['passed', 'failed', 'skipped', 'flaky', 'errored']);

export const RESULTS = [
  {
    id: 'findings',
    name: 'Findings',
    group: 'Work',
    summary: 'Issues anchored to a file and a line, grouped by level.',
    when: 'A scanner, a linter or a review produced a list against the code.',
    fields: {
      items: arr(
        obj({
          message: str({ required: true, maxLen: 400 }),
          level: enom(FINDING_LEVELS, { required: true, accepts: ['annotation_level', 'severity'] }),
          path: str({ maxLen: 240 }),
          line: int({ accepts: ['start_line', 'startLine'] }),
          endLine: int({ accepts: ['end_line'] }),
          rule: str({ maxLen: 80, note: 'The rule id, so a reader can look it up or silence it.' }),
          detail: text({ maxLen: 1200, accepts: ['raw_details'] }),
          href: url(),
          state: enom(['open', 'fixed', 'accepted', 'wontfix'], {
            note: 'In a report about fixes, this is the column the reader came for.',
          }),
        }),
        { required: true, min: 1, max: 500 },
      ),
      counts: obj({}, { derived: true, note: 'Counted per level and per state.' }),
    },
    sample: {
      type: 'findings',
      title: 'What the scanner said',
      items: [
        { message: 'Rate limit state is per process', level: 'error', path: 'src/limiter/bucket.ts', line: 12, rule: 'concurrency/shared-state', state: 'fixed' },
        { message: 'Unbounded retry loop', level: 'warning', path: 'src/limiter/retry.ts', line: 48, rule: 'reliability/retry-bound', state: 'open' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        const noPath = items.filter((i) => i && !i.path).length;
        if (noPath && items.length > 2 && noPath === items.length) {
          add('info', 'No finding carries a path. Without one the reader cannot go and look, which is the only thing this block is for.');
        }
        items.forEach((i) => {
          if (i && i.endLine !== undefined && i.line !== undefined && Number(i.endLine) < Number(i.line)) {
            add('warn', `A finding in "${i.path || '?'}" ends before it starts, so the line span is backwards.`);
          }
        });
        const open = items.filter((i) => i && i.state === 'open').length;
        if (open && !items.some((i) => i?.state && i.state !== 'open')) {
          add('info', 'Every finding is open. If this is a report about fixes, set the state on the ones that were fixed.');
        }
      },
    ],
  },

  {
    id: 'tests',
    name: 'Tests',
    group: 'Work',
    summary: 'A test run: counts, duration and the failures in full.',
    when: 'Something was verified by running it. The strongest evidence there is.',
    fields: {
      suite: str({ maxLen: 120, note: 'What was run.' }),
      duration: num({ note: 'Seconds for the whole run.' }),
      items: arr(
        obj({
          name: str({ required: true, maxLen: 240 }),
          state: enom(TEST_STATES, { required: true, accepts: ['status', 'result'] }),
          duration: num(),
          suite: str({ maxLen: 120, accepts: ['classname'] }),
          message: text({ maxLen: 2000, note: 'The test output, shown whatever the state: the failure in full, or a warning or retry note on a test that passed.' }),
        }),
        { max: 2000, note: 'Omit on a clean run and give the counts instead.' },
      ),
      counts: obj(
        {
          passed: int(), failed: int(), skipped: int(), flaky: int(), errored: int(),
        },
        { note: 'Supply these when the item list is too long to carry. Derived when items are present.' },
      ),
    },
    sample: {
      type: 'tests',
      title: 'Limiter suite',
      suite: 'npm test -- limiter',
      duration: 14.2,
      items: [
        { name: 'shares one counter across four workers', state: 'passed', duration: 2.1 },
        { name: 'falls back when the store is unreachable', state: 'passed', duration: 0.4 },
        { name: 'applies a per-route ceiling', state: 'skipped', message: 'Not implemented, see the scope block.' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        if (!items.length && !b.counts) {
          add('error', 'A tests block needs an item list or a counts object. Otherwise it reports that something was tested without saying what happened.');
        }
        if (items.length && b.counts) {
          add('info', 'Both items and counts are present. The counts are derived from the items and the supplied ones are ignored.');
        }
        items.forEach((t) => {
          if (t && ['failed', 'errored'].includes(t.state) && !t.message) {
            add('warn', `Test "${t.name || '?'}" ${t.state} with no message. A failure with no output cannot be acted on.`);
          }
        });
        const failed = items.filter((t) => t && ['failed', 'errored'].includes(t.state)).length;
        if (failed) {
          add('info', `${failed} test(s) failed in this run. Make sure the report says so above the fold, not only here.`);
        }
      },
    ],
  },
];
