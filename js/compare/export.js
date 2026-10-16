/**
 * A comparison leaving the browser: one offline HTML file, the portable
 * `.dossier-compare.json` bundle, the review as Markdown, and a `#dc=` link
 * when the bundle is small enough to travel in one. Also the other way in:
 * a `#dc=` link opened in this tab.
 *
 * The HTML file is the comparison as it is on screen: Dossier-format columns
 * as their drawn text with every difference mark, original columns as
 * script-less srcdoc frames, the review, and one inline script: the runtime
 * (js/compare/export-runtime.js) for sync and the previous and next change
 * buttons, handed the app's link guard (js/frame-links.js) so a link in an
 * original column never takes the column away from its report. Its policy
 * allows that one script by hash and no network at all.
 *
 * A file made while Blind is on keeps the secret in its markup as well as
 * on screen: every column carries the neutral role, and the column ids our
 * own markup builds into its ids and links ("k1", in "k1-h3" and
 * "cmp-col-k1-label") become report numbers ("r2"), since those ids follow
 * the order the columns were added in, which is usually human, agent, fix.
 */

import { escHtml, copyText, downloadText } from '../neorgon-dom.js';
import { registerActions } from '../actions.js';
import {
  say, sentence, encodeComparison, decodeComparison, comparisonLinkId, COMPARISON_LINK_MAX,
} from '../share.js';
import { routeFor } from '../router.js';
import { embedDocument } from '../embed-policy.js';
import { staticCopy } from './frame.js';
import { toBundle, fromBundleWithNotice, demotedSentence } from './records.js';
import { readSet } from './store.js';
import { nameOf, displayColumns, roleAttr, reportNumbers } from './blind.js';
import { icon } from './icons.js';
import {
  tally, tallySentence, recordSentence, reviewMarkdown, blindOrderSentence, MARK_WORDS,
} from './review-model.js';
import { comparisonRuntime } from './export-runtime.js';
import { guardFrameLinks } from '../frame-links.js';

/** Our own stylesheets the file needs, by file name. */
const SHEETS = /\/css\/(tokens|style|viz|report|blocks|comparison|compare)\.css(\?|$)/;

let current = null;

function slug(text) {
  return String(text || 'comparison').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'comparison';
}

function stylesheets() {
  const out = [];
  for (const sheet of document.styleSheets) {
    if (!sheet.href || !SHEETS.test(sheet.href)) continue;
    try {
      for (const rule of sheet.cssRules) out.push(rule.cssText);
    } catch { /* unreadable: skipped */ }
  }
  // Nothing in the file may load from anywhere.
  return out.join('\n').replace(/url\(\s*["']?(?!data:)[^)]*\)/gi, 'none');
}

async function sha256(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Attributes in which our markup names other elements by id. */
const ID_ATTRS = ['id', 'for', 'headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns',
  'clip-path', 'mask', 'filter', 'fill', 'stroke', 'marker-start', 'marker-mid', 'marker-end', 'href', 'xlink:href'];

/**
 * Put `to` where a column id `from` is part of an id or an in-page
 * reference: "k1-h3", "#k1-h3", "cmp-col-k1-label", "url(#cmp-k1-grad)".
 *
 * @param {Element} root
 */
function renameIds(root, from, to) {
  if (!from || from === to) return;
  const re = new RegExp(`(^|[\\s#(])((?:cmp-(?:col-)?)?)${from}(?=-)`, 'g');
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const name of ID_ATTRS) {
      const value = el.getAttribute(name);
      if (!value || (name.endsWith('href') && !value.startsWith('#'))) continue;
      const next = value.replace(re, `$1$2${to}`);
      if (next !== value) el.setAttribute(name, next);
    }
  }
}

/** A column's text as drawn, with its headings numbered by section group. */
function readerCopy(record, groups, ids = null) {
  record.headingEls.forEach((el, i) => el.setAttribute('data-xh', String(i)));
  const copy = record.scrollEl.cloneNode(true);
  if (ids) renameIds(copy, ids.from, ids.to);
  for (const el of record.headingEls) el.removeAttribute('data-xh');
  for (const el of copy.querySelectorAll('[data-xh]')) {
    const group = groups.get(Number(el.getAttribute('data-xh')));
    el.removeAttribute('data-xh');
    if (Number.isInteger(group)) el.setAttribute('data-sync', String(group));
  }
  for (const tag of copy.querySelectorAll('.cur-tag')) tag.remove();
  // A notice's pointer at a control the file does not have ("Turn on Word
  // marks"): the file's heads carry no buttons.
  for (const hint of copy.querySelectorAll('.col-note__live')) hint.remove();
  // The base's name, kept current on screen without a redraw
  // (js/compare/marks.js `baseName`), is plain text in a file.
  for (const name of copy.querySelectorAll('[data-base-ref]')) name.replaceWith(name.textContent);
  for (const el of copy.querySelectorAll('.u-current')) el.classList.remove('u-current');
  for (const el of copy.querySelectorAll('[data-text-surface]')) el.removeAttribute('data-text-surface');
  // A table fits on screen and drops its region pattern there
  // (js/scroll-regions.js); the file's width is not known, so every table
  // keeps the pattern that lets a keyboard scroll it.
  for (const el of copy.querySelectorAll('[data-region-label]')) {
    el.setAttribute('role', 'region');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', el.dataset.regionLabel);
    el.removeAttribute('data-region-label');
  }
  copy.removeAttribute('style');
  return copy.outerHTML;
}

function frameCopy(set, col, record) {
  const name = nameOf(set, col);
  const title = `${name.blind ? name.label : `Column ${name.ref}, ${col.label}`}, original layout`;
  const srcdoc = embedDocument(staticCopy(col.source.text), false);
  const ran = record?.kind === 'interactive'
    ? '<div class="col__notes"><p class="col-note"><span>In Dossier this column ran its own scripts. The file shows its page without them.</span></p></div>'
    : '';
  return `${ran}<iframe class="col__frame" sandbox="allow-same-origin" referrerpolicy="no-referrer" title="${escHtml(title)}" srcdoc="${escHtml(srcdoc)}"></iframe>`;
}

function headCopy(colEl, ids = null) {
  const head = colEl.querySelector('.col__head').cloneNode(true);
  // "2 numbers changed" stays as words: the file has no list to open.
  for (const b of head.querySelectorAll('.col__nums')) b.replaceWith(Object.assign(document.createElement('span'), { className: 'col__nums', textContent: b.textContent }));
  for (const button of head.querySelectorAll('button')) button.remove();
  if (ids) renameIds(head, ids.from, ids.to);
  return head.innerHTML;
}

function reviewHtml(set, cols) {
  const r = set.review;
  const name = (col) => nameOf(set, col);
  const tallyRows = cols.map((col) => `<li><span class="rb rb--sm" data-role="${roleAttr(set, col)}" aria-hidden="true">${escHtml(name(col).mark)}</span>`
    + `<span class="visually-hidden">${escHtml(name(col).ref)}: </span>${escHtml(tallySentence(tally(set, col.id)))}</li>`).join('');
  const marks = r.criteria.map((crit) => `<tr><th scope="row">${escHtml(crit.label)}</th>${cols.map((col) => {
    const mark = r.marks[crit.id]?.[col.id];
    return `<td>${mark ? escHtml(MARK_WORDS[mark]) : ''}</td>`;
  }).join('')}</tr>`).join('');
  const pref = r.preferred === 'none' ? 'None is adequate.'
    : r.preferred ? (() => {
      const col = cols.find((c) => c.id === r.preferred);
      return col ? (name(col).blind ? name(col).label : `${name(col).ref}, ${col.label}`) : 'Not chosen.';
    })() : 'Not chosen.';
  const notes = cols.filter((col) => r.notes[col.id]).map((col) => `<h3>${escHtml(name(col).blind ? name(col).label : `${name(col).ref}, ${col.label}`)}</h3><p class="x-text">${escHtml(r.notes[col.id])}</p>`).join('');
  return `<section class="panel"><div class="panel__head"><h2 id="xReviewTitle">Review</h2>
      <button type="button" class="btn btn--quiet btn--sm btn--icon" id="xReviewClose" aria-label="Close review">${icon('x')}</button></div>
    <div class="panel__body">
      <p class="panel__intro">The reviewer's own marks. Dossier counts them and never scores a report.</p>
      <p class="panel__intro">${escHtml(recordSentence(set, { copy: true }))}</p>
      ${blindOrderSentence(set) ? `<p class="panel__intro">${escHtml(blindOrderSentence(set))}</p>` : ''}
      <ul class="tally">${tallyRows}</ul>
      ${r.criteria.length ? `<table class="x-marks"><thead><tr><th scope="col">Criterion</th>${cols.map((col) => `<th scope="col">${escHtml(name(col).ref)}</th>`).join('')}</tr></thead><tbody>${marks}</tbody></table>` : ''}
      <h3>Preferred</h3><p>${escHtml(pref)}</p>
      ${notes ? `<h3>Notes</h3>${notes}` : ''}
      ${r.summary.trim() ? `<h3>Summary</h3><p class="x-text">${escHtml(r.summary)}</p>` : ''}
    </div></section>`;
}

/**
 * The brief, open and without buttons: the file has no editor. Shared by
 * every report, so it stays in a blind file too.
 */
function briefCopy(set) {
  const brief = String(set.prompt || '').trim();
  if (!brief) return '';
  return `<section class="cmp-brief is-open" aria-labelledby="xBriefLbl"><span class="cmp-brief__lbl" id="xBriefLbl">Brief</span>`
    + `<p class="cmp-brief__text">${escHtml(brief)}</p></section>`;
}

const EXTRA_CSS = `
.x-toolbar .x-title { min-width: 0; overflow: hidden; font-family: var(--font-reading); font-size: var(--text-base); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.x-toolbar .x-meta { font-size: var(--text-xs); color: var(--text-secondary); white-space: nowrap; }
.x-text { white-space: pre-wrap; }
.x-marks { width: 100%; margin-top: 12px; border-collapse: collapse; font-size: var(--text-xs); }
.x-marks th, .x-marks td { padding: 5px 4px; border-bottom: 1px solid var(--border); text-align: left; }
#compareView .tally { list-style: none; }
@media (max-width: 699px) { .x-toolbar .x-meta, .x-toolbar .x-title { display: none; } }
@media (max-width: 699px) { .x-toolbar .focus-switch { flex: 1 1 100%; } }
`;

/**
 * The whole comparison as one HTML file.
 *
 * @returns {Promise<string>}
 */
async function comparisonHtml() {
  const { api, analysis } = current;
  const { compare } = api;
  const set = compare.set;
  const cols = displayColumns(set).filter((col) => col.source);
  const base = analysis.baseId(set);
  const baseHeadings = base ? compare.sync.headings(base) : [];
  // The file starts on the column whose changes the counter was showing.
  const active = analysis.changeColumn();
  const columns = [];
  const tabs = [];
  // While blind, a column is known in the file by its report number only.
  const numbers = set.view.blind ? reportNumbers(set) : null;
  for (const col of cols) {
    const colEl = compare.refs.root.querySelector(`#cmp-col-${col.id}`);
    const record = compare.ui.records.get(col.id);
    if (!colEl || !record) continue;
    const name = nameOf(set, col);
    const xid = numbers ? `r${numbers.get(col.id) || 0}` : col.id;
    const ids = xid === col.id ? null : { from: col.id, to: xid };
    const role = roleAttr(set, col);
    let body = '';
    if (record.kind === 'reader' || record.kind === 'error') {
      const groups = new Map();
      if (base && compare.sync.has(col.id)) {
        if (col.id === base) baseHeadings.forEach((_, i) => groups.set(i, i));
        else for (const pair of compare.sync.pairs(base, col.id)) groups.set(pair.b, pair.a);
      }
      body = `<div class="col__body">${readerCopy(record, groups, ids)}</div>`;
    } else {
      body = `<div class="col__body col__body--frame">${frameCopy(set, col, record)}</div>`;
    }
    const focus = col.id === set.view.focus || (!cols.some((c) => c.id === set.view.focus) && col === cols[0]);
    columns.push(`<section class="col${focus ? ' is-focus' : ''}${col.id === base && set.view.diff.on ? ' is-base' : ''}" data-col="${xid}" data-role="${role}"${col.id === active ? ' data-active' : ''}`
      + ` data-name="${escHtml(name.ref)}" aria-label="${escHtml(name.blind ? name.label : `Column ${name.ref}, ${col.label}`)}">`
      + `<header class="col__head">${headCopy(colEl, ids)}</header>${body}</section>`);
    tabs.push(`<button type="button" role="tab" aria-selected="${focus}" data-col="${xid}" data-role="${role}">`
      + `<span class="rb" aria-hidden="true">${escHtml(name.mark)}</span><span class="focus-switch__word">${escHtml(name.blind ? name.label : name.role)}</span></button>`);
  }
  const title = set.view.blind ? 'Blind review' : set.title;
  let against = 'Differences off';
  if (base && set.view.diff.on) against = analysis.isEach(set) ? 'Differences against each column\'s source' : `Differences against ${nameOf(set, base).ref}`;
  const when = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // The link guard travels beside the runtime, inside the one hashed script,
  // so an Original column's links stay in it (js/frame-links.js).
  const script = `(${comparisonRuntime.toString()})(document, ${guardFrameLinks.toString()});`;
  const hash = await sha256(script);
  const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'self'; base-uri 'none'; form-action 'none'`;
  const html = document.documentElement;
  const dark = html.dataset.appearance ? html.dataset.appearance === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const attrs = ['readingSize', 'measure', 'typeface', 'compareSize']
    .map((k) => (html.dataset[k] ? ` data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${escHtml(html.dataset[k])}"` : '')).join('');
  const measure = html.style.getPropertyValue('--measure');
  const classes = ['has-diff', set.view.diff.on ? '' : 'diff-off', set.view.diff.showRemoved ? '' : 'hide-removed', set.view.blind ? 'blind' : '']
    .filter(Boolean).join(' ');
  return `<!DOCTYPE html>
<html lang="en" data-dossier-view="compare" data-appearance="${dark ? 'dark' : 'light'}"${attrs}${measure ? ` style="--measure: ${escHtml(measure)}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="generator" content="Dossier">
<title>${escHtml(title)} | Dossier comparison</title>
<style>
${stylesheets()}
${EXTRA_CSS}
</style>
</head>
<body>
<main id="main">
<div id="compareView" class="${classes}">
  <div class="cmp-toolbar x-toolbar" role="group" aria-label="Comparison controls">
    <span class="x-title">${escHtml(title)}</span>
    <div class="seg focus-switch" role="tablist" aria-label="Column to read">${tabs.join('')}</div>
    <span class="x-meta">${escHtml(against)}. Exported ${escHtml(when)}.</span>
    <label class="picker"><span class="lbl">Sync</span><select id="xSync" aria-label="Sync scrolling">
      <option value="sections">Sections</option><option value="scroll">Scroll</option><option value="off">Off</option></select></label>
    <div class="tb-nav" role="group" aria-label="Move through the changes">
      <button type="button" class="btn btn--icon btn--sm" id="xPrev" aria-label="Previous change" aria-keyshortcuts="[">${icon('left')}</button>
      <span class="counter" id="xCounter"><span class="counter__main">0 of 0</span><small class="counter__sub"></small></span>
      <button type="button" class="btn btn--icon btn--sm" id="xNext" aria-label="Next change" aria-keyshortcuts="]">${icon('right')}</button>
    </div>
    <span class="tb-spacer"></span>
    <button type="button" class="btn toggle" id="xRemoved" aria-pressed="${Boolean(set.view.diff.showRemoved)}"><span class="box">${icon('check')}</span>Removed words</button>
    <button type="button" class="btn" id="xReview" aria-pressed="false" aria-controls="xPanel">Review</button>
  </div>
  ${briefCopy(set)}
  <div class="cmp-body">
    <div class="cmp-columns" style="--cols: ${Math.max(1, columns.length)}">${columns.join('\n')}</div>
    <aside class="cmp-panel" id="xPanel" aria-labelledby="xReviewTitle" hidden>${reviewHtml(set, cols)}</aside>
  </div>
  <p class="visually-hidden" id="xLive" role="status" aria-live="polite"></p>
</div>
</main>
<script>${script}</script>
</body>
</html>
`;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function closeDialog() {
  const dialog = document.getElementById('exportDialog');
  if (dialog?.open) dialog.close();
}

async function exportHtml() {
  try {
    const set = current.api.compare.set;
    // A comparison named after its report would download under the report's
    // own name: "-comparison" keeps the two apart in a downloads folder.
    const stem = slug(set.view.blind ? 'blind-review' : set.title);
    const name = set.view.blind || /(^|-)comparison$/.test(stem) ? stem : `${stem}-comparison`;
    downloadText(await comparisonHtml(), `${name}.html`, 'text/html');
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('The comparison file could not be built', err);
    say('The comparison file could not be built. Nothing was downloaded.');
    return false;
  }
}

function exportBundle() {
  const set = current.api.compare.set;
  downloadText(`${JSON.stringify(toBundle(set), null, 2)}\n`, `${slug(set.title)}.dossier-compare.json`, 'application/json');
}

async function copyReview() {
  const set = current.api.compare.set;
  const cols = displayColumns(set).filter((col) => col.source);
  if (!cols.length) {
    say('Put a report in a column before copying the review.');
    return false;
  }
  const ok = await copyText(reviewMarkdown(set, cols, (col) => nameOf(set, col)));
  say(ok ? 'Copied the review as Markdown.' : 'The review could not be copied here. Open the Review panel and use its Copy button.');
  return ok;
}

/** Copy a `#dc=` link to the open comparison, or say why there is none. */
export async function copyComparisonLink() {
  const set = current?.api.compare.set;
  if (!set) return false;
  const encoded = await encodeComparison(toBundle(set));
  if (!encoded) {
    say('This browser cannot compress a link. Download the comparison file instead.');
    return false;
  }
  if (!encoded.fits) {
    say(`At ${encoded.payload.length.toLocaleString('en-US')} characters this comparison is too long for a link. Download the HTML file or the comparison file instead.`);
    return false;
  }
  const url = new URL(location.href);
  url.search = '';
  url.hash = encoded.fragment.slice(1);
  const ok = await copyText(url.toString());
  say(ok
    ? 'Link copied. Anyone with the link has every report in the comparison and its review: there is no sign-in on it.'
    : 'Could not copy to the clipboard.');
  return ok;
}

/**
 * The Share and export dialog's choices while in Compare, with the link's
 * size measured for this comparison.
 *
 * @returns {Promise<Array<{action: string, name: string, note: string, disabled?: boolean}>>}
 */
export async function comparisonChoices() {
  const set = current?.api.compare.set;
  if (!set) return [];
  const encoded = await encodeComparison(toBundle(set)).catch(() => null);
  const size = encoded ? encoded.payload.length.toLocaleString('en-US') : null;
  let link;
  if (!encoded) link = { note: 'This browser cannot compress a link. Send one of the files instead.', disabled: true };
  else if (!encoded.fits) {
    link = {
      note: `The link would be ${size} characters, over the ${COMPARISON_LINK_MAX.toLocaleString('en-US')} a link can carry. Send the HTML file or the comparison file instead.`,
      disabled: true,
    };
  } else link = { note: `About ${size} characters. Anyone with the link has every report and the review.`, disabled: false };
  return [
    { action: 'cmp-share-link', name: 'Copy link', ...link },
    { action: 'cmp-export-html', name: 'One HTML file', note: 'The comparison as you see it, marks and review included. Opens with no network. The one to send.' },
    { action: 'cmp-export-bundle', name: 'Comparison file', note: 'Every report, the view and the review, as .dossier-compare.json. Opens again in Dossier.' },
    displayColumns(set).some((col) => col.source)
      ? { action: 'cmp-export-review', name: 'Copy review as Markdown', note: 'Your marks, notes and summary, for a ticket or a message.' }
      : { action: 'cmp-export-review', name: 'Copy review as Markdown', note: 'No column holds a report yet, so there is no review to copy.', disabled: true },
  ];
}

/**
 * @param {object} api from js/compare/index.js
 * @param {object} analysis from js/compare/analysis.js
 */
export function initExport(api, analysis) {
  current = { api, analysis };
  registerActions({
    'cmp-share-link': () => { closeDialog(); return copyComparisonLink(); },
    'cmp-export-html': () => { closeDialog(); return exportHtml(); },
    'cmp-export-bundle': () => { closeDialog(); exportBundle(); },
    'cmp-export-review': () => { closeDialog(); return copyReview(); },
  });
  // A `#dc=` link: open the comparison it carries, saved in this browser
  // under an id taken from the link itself, so opening the same link again
  // reopens that copy instead of saving another.
  api.compare.hooks.loadPayload = async () => {
    const hash = location.hash;
    const bundle = await decodeComparison(hash);
    history.replaceState(history.state, '', `${location.pathname}${location.search}${routeFor({ view: 'compare' })}`);
    const id = bundle ? await comparisonLinkId(hash) : null;
    const found = id ? await readSet(id) : null;
    if (found) {
      api.openSet(found, { saved: true, push: true });
      api.compare.example = false;
      const again = 'It was already saved in this browser, so it opens with any changes made to it here';
      // Under Blind the title stays hidden.
      say(found.view.blind
        ? `Opened the comparison from the link, under Blind review. ${again}.`
        : sentence(`Opened the comparison "${found.title}" from the link. ${again}`));
      return true;
    }
    const read = bundle ? fromBundleWithNotice(bundle, id ? { id } : undefined) : null;
    if (!read) {
      say('That comparison link is incomplete or damaged. Ask for the link again, or for the comparison file.');
      return false;
    }
    const { set, demoted } = read;
    await api.openBundleSet(set);
    // A comparison sent under Blind opens under Blind: its title stays hidden.
    const opened = set.view.blind
      ? 'Opened the comparison from the link, under Blind review. It is now saved in this browser.'
      : sentence(`Opened the comparison "${set.title}" from the link. It is now saved in this browser`);
    // A column that asked to run its scripts opened in Original instead.
    say(demoted.length ? `${opened} ${demotedSentence(set, demoted)}` : opened);
    return true;
  };
}
