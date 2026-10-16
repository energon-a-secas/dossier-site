/**
 * Preferences are shared by every tab of this site through one localStorage
 * key. A write used to save this tab's whole memory of them, so a second
 * tab's newer value was put back to what this tab had loaded. The case that
 * bit: a report deleted in another tab made this tab clear `lastReportId`,
 * and the write wiped the id the other tab had just saved.
 *
 * Two state objects over one fake localStorage stand in for two tabs.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'dossier-site:preferences';
const data = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  },
});

const { loadSaved, setPreference, forgetPreference } = await import('../js/state.js');

const tab = () => { const s = { preferences: {} }; loadSaved(s); return s; };
const storedPrefs = () => JSON.parse(data.get(KEY)).data;

beforeEach(() => data.clear());

test('setting one preference keeps what another tab saved since', () => {
  const a = tab();
  const b = tab();
  setPreference(b, 'lastReportId', 'doc-b');
  setPreference(a, 'railOpen', false);
  assert.equal(storedPrefs().lastReportId, 'doc-b', 'tab A wrote its stale lastReportId over tab B’s');
  assert.equal(storedPrefs().railOpen, false);
  // Tab A's memory of its own change is right; a reload reads both.
  assert.equal(a.preferences.railOpen, false);
  assert.deepEqual({ ...tab().preferences }, { ...storedPrefs() });
});

test('a deleted report is forgotten only where it is still the last report', () => {
  const a = tab();
  setPreference(a, 'lastReportId', 'doc-x');
  const b = tab();
  // Tab B opens another report, then deletes doc-x. Tab A hears the delete.
  setPreference(b, 'lastReportId', 'doc-y');
  forgetPreference(a, 'lastReportId', ['doc-x']);
  assert.equal(a.preferences.lastReportId, null, 'tab A still remembers the deleted report');
  assert.equal(storedPrefs().lastReportId, 'doc-y', 'tab B’s newer last report was wiped');
});

test('a deleted report that is still the stored last report is cleared', () => {
  const a = tab();
  setPreference(a, 'lastReportId', 'doc-x');
  setPreference(a, 'readMode', false);
  forgetPreference(a, 'lastReportId', ['doc-x', 'doc-z']);
  assert.equal(storedPrefs().lastReportId, null);
  assert.equal(storedPrefs().readMode, false, 'clearing one key reset another');
  assert.equal(a.preferences.lastReportId, null);
});

test('forgetting leaves memory alone when it names another report', () => {
  const a = tab();
  setPreference(a, 'lastReportId', 'doc-keep');
  assert.equal(forgetPreference(a, 'lastReportId', ['doc-gone']), true);
  assert.equal(a.preferences.lastReportId, 'doc-keep');
  assert.equal(storedPrefs().lastReportId, 'doc-keep');
});

test('unknown keys are refused, and stored values are still validated', () => {
  const a = tab();
  assert.equal(setPreference(a, 'nonsense', 1), false);
  assert.equal(forgetPreference(a, 'nonsense', [1]), false);
  data.set(KEY, JSON.stringify({ __v: 1, data: { sourceTab: 'evil', lastReportId: 5, railOpen: 'yes' } }));
  setPreference(a, 'showFindings', true);
  const now = storedPrefs();
  assert.equal(now.sourceTab, 'form');
  assert.equal(now.lastReportId, null);
  assert.equal(now.railOpen, null);
  assert.equal(now.showFindings, true);
});
