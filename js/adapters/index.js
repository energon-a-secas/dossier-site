/**
 * Adapter registry and detection.
 *
 * Each adapter is a pure function (except html.js) that converts foreign
 * formats to a Dossier document. The registry lists them in order so the
 * UI can offer them to the reader.
 */

import { toDossier as numstatToDossier } from './numstat.js';
import { toDossier as junitToDossier } from './junit.js';
import { toDossier as sarifToDossier } from './sarif.js';
import { toDossier as ctrfToDossier, ctrfTests } from './ctrf.js';
import { toDossier as commitsToDossier } from './commits.js';
import { toDossier as markdownToDossier } from './markdown.js';
import { toDossier as htmlToDossier } from './html.js';
import { toDossier as lighthouseToDossier } from './lighthouse.js';

export const ADAPTERS = [
  {
    id: 'html',
    label: 'HTML',
    test: (src) => detectHtml(src),
    toDossier: htmlToDossier,
  },
  {
    id: 'numstat',
    label: 'Git diff stats',
    test: (src) => detectNumstat(src),
    toDossier: numstatToDossier,
  },
  {
    id: 'junit',
    label: 'JUnit test results',
    test: (src) => detectJunit(src),
    toDossier: junitToDossier,
  },
  {
    id: 'sarif',
    label: 'SARIF findings',
    test: (src) => detectSarif(src),
    toDossier: sarifToDossier,
  },
  {
    id: 'ctrf',
    label: 'CTRF test report',
    test: (src) => detectCtrf(src),
    toDossier: ctrfToDossier,
  },
  {
    id: 'commits',
    label: 'Conventional Commits',
    test: (src) => detectCommits(src),
    toDossier: commitsToDossier,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    test: (src) => detectMarkdown(src),
    toDossier: markdownToDossier,
  },
  {
    id: 'lighthouse',
    label: 'Lighthouse report',
    test: (src) => detectLighthouse(src),
    toDossier: lighthouseToDossier,
  },
];

/**
 * A comparison bundle (`{"dossierCompare": {...}}`, the Compare view's
 * portable file). Not a report and not converted: the Open dialog hands it to
 * the Compare view, which opens it as a whole comparison. Kept out of
 * ADAPTERS, which lists the formats that become a report.
 */
export const COMPARISON_BUNDLE = Object.freeze({
  id: 'dossier-compare',
  label: 'Dossier comparison',
  bundle: true,
});

export function detect(source) {
  if (!source || typeof source !== 'string') return null;

  // Native documents may contain HTML or Markdown inside a block. Malformed
  // JSON must also reach the document parser for a useful error.
  if (/^\s*[\[{]/.test(source)) {
    try {
      const value = JSON.parse(source);
      if (value?.dossierCompare && typeof value.dossierCompare === 'object') return COMPARISON_BUNDLE;
      if (value?.dossier || Array.isArray(value?.pages)) return null;
    } catch { return null; }
  }

  for (const adapter of ADAPTERS) {
    if (adapter.test(source)) {
      return adapter;
    }
  }

  return null;
}

function detectNumstat(src) {
  return /^\d+\s+\d+\s+/.test(src.trim());
}

function detectJunit(src) {
  return /<testsuite\b/.test(src);
}

function detectSarif(src) {
  try {
    const obj = JSON.parse(src);
    return obj && (obj.$schema?.includes('sarif') || obj.runs);
  } catch {
    return false;
  }
}

// The adapter decides what a CTRF test list is, so detection and conversion
// cannot disagree. Detection used to require `results.tool` while the adapter
// read `results` as an array, so the bundled CTRF fixture matched neither.
function detectCtrf(src) {
  try {
    return Boolean(ctrfTests(JSON.parse(src)));
  } catch {
    return false;
  }
}

function detectCommits(src) {
  return /^(feat|fix|docs|style|refactor|perf|test|chore)(\(.+?\))?!?:/m.test(src);
}

function detectMarkdown(src) {
  return /^#+\s|^-\s|^\*\s|^\d+\.\s|^```|^>|^\|/m.test(src);
}

function detectLighthouse(src) {
  try {
    const obj = JSON.parse(src);
    return obj && obj.lighthouseVersion;
  } catch {
    return false;
  }
}

function detectHtml(src) {
  const start = src.trimStart().replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  return /^(?:<!doctype\s+html\b|<(?:html|head|body|main|section|article|div|p|table|h[1-6]|style|svg|script)\b)/i.test(start);
}
