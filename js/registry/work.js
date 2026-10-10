/**
 * Work blocks: what was actually touched.
 *
 * These are the blocks a reviewer trusts most, because they are the closest
 * thing in the document to the artefact itself. A diff is not a claim about
 * a change, it is the change. Where a block can carry the real thing rather
 * than a summary of it, the format asks for the real thing.
 */

import { str, text, num, int, bool, url, date, enom, arr, obj, TONES } from './types.js';

export const FILE_STATES = Object.freeze(['added', 'modified', 'removed', 'renamed', 'moved']);
export const CHECK_STATES = Object.freeze(['done', 'partial', 'skipped', 'blocked', 'todo']);

export const WORK = [
  {
    id: 'files',
    name: 'Files touched',
    group: 'Work',
    summary: 'The paths that changed, with churn per path and a derived total.',
    when: 'Any report about a code change. This is the table of contents of the work.',
    fields: {
      items: arr(
        obj({
          path: str({ required: true, maxLen: 240 }),
          state: enom(FILE_STATES, { note: 'Defaults to modified.' }),
          added: int({ note: 'Lines added.' }),
          removed: int({ note: 'Lines removed.' }),
          from: str({ maxLen: 240, note: 'The old path, for renamed or moved.' }),
          href: url(),
          note: str({ maxLen: 160 }),
        }),
        { required: true, min: 1, max: 600 },
      ),
      totals: obj({}, { derived: true, note: 'Counted from the items. Do not supply it.' }),
    },
    sample: {
      type: 'files',
      title: 'Files touched',
      items: [
        { path: 'src/limiter/bucket.ts', state: 'modified', added: 48, removed: 31 },
        { path: 'src/limiter/shared-store.ts', state: 'added', added: 112, removed: 0 },
        { path: 'src/limiter/per-process.ts', state: 'removed', added: 0, removed: 87 },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach((f) => {
          if (f && ['renamed', 'moved'].includes(f.state) && !f.from) {
            add('warn', `"${f.path || '?'}" is ${f.state} with no "from", so the reader cannot see what it was.`);
          }
        });
        const noChurn = items.filter((f) => f && f.added === undefined && f.removed === undefined).length;
        if (noChurn && noChurn === items.length && items.length > 3) {
          add('info', 'No line counts on any path. With them the block shows where the work actually landed, rather than a flat list.');
        }
      },
    ],
  },

  {
    id: 'diff',
    name: 'Diff',
    group: 'Work',
    summary: 'A unified patch, or a before and after of one file.',
    when: 'A change is small enough to read and important enough to show.',
    fields: {
      path: str({ maxLen: 240 }),
      language: str({ maxLen: 24, note: 'For highlighting. Guessed from the path when absent.' }),
      patch: text({ maxLen: 40000, note: 'Unified diff text. Hunk headers are parsed for line numbers.' }),
      before: text({
        maxLen: 20000,
        accepts: ['oldText'],
        note: 'Use with "after" instead of a patch. The Agent Client Protocol calls this oldText and that spelling is accepted.',
      }),
      after: text({ maxLen: 20000, accepts: ['newText'] }),
      view: enom(['unified', 'split'], { note: 'Defaults to unified. Split needs width.' }),
      stats: obj({}, { derived: true, note: 'Added and removed counts, parsed from the patch.' }),
    },
    sample: {
      type: 'diff',
      path: 'src/limiter/bucket.ts',
      language: 'ts',
      patch: '@@ -12,7 +12,7 @@\n-  const count = local.get(key) ?? 0;\n+  const count = await shared.get(key) ?? 0;\n',
    },
    lint: [
      (b, add) => {
        const hasPatch = typeof b.patch === 'string' && b.patch.trim();
        const hasPair = typeof b.before === 'string' || typeof b.after === 'string';
        if (!hasPatch && !hasPair) {
          add('error', 'A diff needs a "patch", or a "before" and "after" pair.');
        }
        if (hasPatch && hasPair) {
          add('warn', 'A diff carries both a patch and a before/after pair. The patch wins and the pair is ignored.');
        }
        if (hasPatch && !/^@@|^(---|\+\+\+)/m.test(b.patch)) {
          add('info', 'The patch has no hunk header, so line numbers cannot be shown. Include the @@ lines if you have them.');
        }
        if (hasPatch && b.patch.length > 12000) {
          add('info', 'A patch over 12,000 characters is not read, it is scrolled. Show the hunk that matters and link the rest.');
        }
      },
    ],
  },

  {
    id: 'code',
    name: 'Code',
    group: 'Work',
    summary: 'A snippet, highlighted, with optional emphasised lines.',
    when: 'The reader needs to see the shape of something, not a change to it.',
    fields: {
      source: text({ required: true, maxLen: 20000 }),
      language: str({ maxLen: 24 }),
      path: str({ maxLen: 240, note: 'Shown as the caption.' }),
      startLine: int({ note: 'Numbering offset, so the lines match the file.' }),
      highlight: arr(int(), { max: 40, note: 'Line numbers to emphasise.' }),
    },
    sample: {
      type: 'code',
      path: 'src/limiter/shared-store.ts',
      language: 'ts',
      source: 'export async function take(key: string, cost = 1) {\n  return redis.eval(TAKE, 1, key, cost);\n}',
    },
    lint: [
      (b, add) => {
        if (!b.language) {
          add('info', 'Code has no language, so it renders unhighlighted. Even "text" is better than nothing.');
        }
      },
    ],
  },

  {
    id: 'log',
    name: 'Log',
    group: 'Work',
    summary: 'Captured output, folded by default, with ANSI colour preserved.',
    when: 'The evidence is a terminal. Paste it rather than describing it.',
    fields: {
      source: text({ required: true, maxLen: 200000 }),
      ansi: bool({ note: 'Interpret colour escapes. Detected when absent.' }),
      lines: int({ derived: true }),
      highlight: arr(str(), { max: 20, note: 'Substrings to mark, for example "FAIL".' }),
    },
    sample: {
      type: 'log',
      title: 'Load test, after',
      collapsed: true,
      source: 'running 200 rps for 60s\n  429 responses: 24118\n  200 responses: 11882\n  p95: 182ms',
    },
    lint: [
      (b, add) => {
        const src = String(b.source || '');
        if (src.split('\n').length > 40 && b.collapsed !== true) {
          add('info', 'A log over 40 lines pushes the rest of the page below the fold. Set "collapsed": true.');
        }
        if (/\b(?:[A-Za-z0-9+/]{40,}={0,2})\b/.test(src)) {
          add('warn', 'The log contains a long opaque token. Check it is not a credential before sharing this report.');
        }
        if (/(?:password|secret|api[_-]?key|bearer)\s*[:=]/i.test(src)) {
          add('warn', 'The log mentions a password, secret, key or bearer token next to a value. Redact it before sharing.');
        }
      },
    ],
  },

  {
    id: 'checklist',
    name: 'Checklist',
    group: 'Work',
    summary: 'What was done, what was not, and why not.',
    when: 'The scope was a list. This is the block that reports honestly.',
    fields: {
      items: arr(
        obj({
          label: str({ required: true, maxLen: 160 }),
          state: enom(CHECK_STATES, { required: true }),
          note: text({ maxLen: 400, note: 'Required by the linter for anything not done.' }),
        }),
        { required: true, min: 1, max: 60 },
      ),
      done: int({ derived: true }),
    },
    sample: {
      type: 'checklist',
      title: 'Scope',
      items: [
        { label: 'Share one counter across workers', state: 'done' },
        { label: 'Per-route limits', state: 'skipped', note: 'Needs a config schema change, raised as a separate ticket.' },
        { label: 'Production rollout', state: 'blocked', note: 'Waiting on the Thursday release window.' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach((i) => {
          if (i && ['skipped', 'blocked', 'partial'].includes(i.state) && !i.note) {
            add('warn', `"${i.label || '?'}" is ${i.state} with no note. An unexplained gap reads as an oversight rather than a decision.`);
          }
        });
      },
    ],
  },

  {
    id: 'timeline',
    name: 'Timeline',
    group: 'Work',
    summary: 'What happened when, in order, with a tone per entry.',
    when: 'The sequence matters: an incident, a rollout, a long investigation.',
    fields: {
      items: arr(
        obj({
          at: str({ required: true, maxLen: 40, note: 'A date, an instant, or a relative label like "day 2".' }),
          label: str({ required: true, maxLen: 160 }),
          detail: text({ maxLen: 600 }),
          tone: enom(TONES),
          href: url({ note: 'What shows that this happened at this time. The incident genre calls it the data link.' }),
        }),
        { required: true, min: 2, max: 60 },
      ),
    },
    sample: {
      type: 'timeline',
      title: 'How it went',
      items: [
        { at: '2026-10-01 09:14', label: 'Paged on a 429 storm', tone: 'bad' },
        { at: '2026-10-01 11:40', label: 'Found the per-process counter', tone: 'info' },
        { at: '2026-10-09 16:02', label: 'Shared counter live on staging', tone: 'good' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        const parsed = items.map((i) => Date.parse(i?.at)).filter((n) => !Number.isNaN(n));
        if (parsed.length === items.length && items.length > 1) {
          const sorted = [...parsed].every((v, i, a) => i === 0 || a[i - 1] <= v);
          if (!sorted) {
            add('warn', 'Timeline entries are not in chronological order. They render in the order given, so the reader sees time run backwards.');
          }
        }
      },
    ],
  },
];
