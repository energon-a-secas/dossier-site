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
import { toDossier as ctrfToDossier } from './ctrf.js';
import { toDossier as commitsToDossier } from './commits.js';
import { toDossier as markdownToDossier } from './markdown.js';
import { toDossier as htmlToDossier } from './html.js';
import { toDossier as lighthouseToDossier } from './lighthouse.js';

export const ADAPTERS = [
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
  {
    id: 'html',
    label: 'HTML',
    test: (src) => detectHtml(src),
    toDossier: htmlToDossier,
  },
];

export function detect(source) {
  if (!source || typeof source !== 'string') return null;

  for (const adapter of ADAPTERS) {
    if (adapter.test(source)) {
      return adapter.id;
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

function detectCtrf(src) {
  try {
    const obj = JSON.parse(src);
    return obj && obj.results && obj.results.tool;
  } catch {
    return false;
  }
}

function detectCommits(src) {
  return /^(feat|fix|docs|style|refactor|perf|test|chore)(\(.+?\))?:/m.test(src);
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
  return /<(html|body|div|p|table|h[1-6])\b/i.test(src);
}
