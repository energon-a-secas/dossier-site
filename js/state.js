/**
 * Shared mutable state, and the one small store of preferences.
 *
 * The split is deliberate. A report document is large, sometimes carries an
 * inlined screenshot, and belongs in IndexedDB through js/store.js. What lives
 * in localStorage is a handful of validated preferences, through the fleet
 * Persist Kit, which never throws in private browsing or on a full quota.
 *
 * Never Object.assign saved JSON onto runtime state: a cache, a credential or
 * an in-flight request does not belong in a preference file.
 */

import { createStore } from './neorgon-persist.js';

const preferences = createStore({ key: 'dossier-site:preferences', version: 1 });

const SOURCE_TABS = ['form', 'json'];

export const state = {
  /** The parsed, derived model the renderer reads. Never serialised as is. */
  model: null,
  /** The last model that parsed cleanly, kept so an error is never destructive. */
  lastGood: null,
  /** The document as authored, which is what gets saved and shared. */
  document: null,
  /** The id of the record in js/store.js, or null for an unsaved report. */
  reportId: null,
  /** Which page of the report is on screen. */
  page: null,
  /** Findings from the parser and the validator, merged. */
  findings: [],
  /** A fatal parse error, or null. The last good model stays on screen. */
  fatal: null,
  /** True while the report came from the URL rather than from this browser. */
  fromUrl: false,
  preferences: {},
};

/** Only these keys are read back, and only when they still make sense. */
export function loadSaved(s) {
  const saved = preferences.load({});
  const ok = saved && typeof saved === 'object' && !Array.isArray(saved);
  const src = ok ? saved : {};

  s.preferences = {
    sourceTab: SOURCE_TABS.includes(src.sourceTab) ? src.sourceTab : 'form',
    showFindings: src.showFindings === true,
    lastReportId: typeof src.lastReportId === 'string' ? src.lastReportId : null,
    seenWelcome: src.seenWelcome === true,
    readMode: src.readMode === true,
  };
  return s.preferences;
}

/** False means this session works, but the preference could not be saved. */
export function save(s) {
  return preferences.save(s.preferences);
}

/** Set one preference and persist it, without caring whether that worked. */
export function setPreference(s, key, value) {
  if (!Object.prototype.hasOwnProperty.call(s.preferences, key)) return false;
  s.preferences[key] = value;
  return save(s);
}
