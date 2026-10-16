/**
 * The Sections panel: which of the base column's sections each report has,
 * has under another name, or left out, and the sections only another column
 * has. This is the "what did the author leave out" view. Design spec 7.3.8.
 *
 * Rows follow the base. Headings are matched by their words, never by
 * meaning (js/compare/align.js), and the panel says so. "Missing" is plain
 * secondary ink with a dashed hollow circle, never red: it is a fact about
 * the text, not a verdict. Selecting a row brings that section to the
 * reading line of every column that has it (design spec 7.3.8): each column
 * is put at its own heading for the row (js/compare/analysis.js
 * `goToSection`), so a section another column moved comes along too, which
 * sync alone, following the leader by aligned headings, did not do.
 *
 * The section level of a column is the level under its title, as the stats
 * line counts sections (js/compare/extract.js `sectionCount`).
 */

import { escHtml } from '../neorgon-dom.js';
import { icon } from './icons.js';
import { sectionMatrix, similarity, MATCH, SAME } from './align.js';
import { nameOf, displayColumns, roleAttr } from './blind.js';

/**
 * The section headings of a column: the level under a lone title, or the
 * top level. Each keeps its index in the column's full heading list.
 *
 * @param {Array<{text: string, level: number}>} headings
 * @returns {Array<{text: string, level: number, index: number}>}
 */
export function sectionsOf(headings) {
  const list = (headings || []).map((h, index) => ({ text: h.text, level: h.level || 2, index }));
  if (!list.length) return [];
  const top = Math.min(...list.map((h) => h.level));
  const atTop = list.filter((h) => h.level === top);
  if (atTop.length === 1 && list[0].level === top && list.length > 1) {
    const below = list.filter((h) => h.level > top);
    const next = Math.min(...below.map((h) => h.level));
    return below.filter((h) => h.level === next);
  }
  return atTop;
}

/**
 * The matrix, as data: rows for the base's sections, then the sections only
 * other columns have, and a coverage line per column.
 *
 * @param {string} baseId
 * @param {Array<{id: string}>} columns in display order
 * @param {(colId: string) => Array<{text: string, level: number}>|null} headingsOf
 *   null when a column's headings cannot be read (a column running its scripts)
 */
export function buildSections(baseId, columns, headingsOf) {
  const base = sectionsOf(headingsOf(baseId) || []);
  const others = {};
  const sections = {};
  for (const col of columns) {
    if (col.id === baseId) continue;
    const list = headingsOf(col.id);
    if (!list) continue;
    sections[col.id] = sectionsOf(list);
    others[col.id] = sections[col.id];
  }
  const { rows, extra } = sectionMatrix(base, others);
  // The alignment keeps order, which sync needs. A section moved elsewhere
  // in a column is still there, so a base row it missed takes the column's
  // closest unmatched heading, if one is close enough.
  for (const [colId, left] of Object.entries(extra)) {
    for (const row of rows) {
      if (row.cells[colId]?.state !== 'missing') continue;
      let best = null;
      for (const h of left) {
        const sim = similarity(row.text, h.text);
        if (sim >= MATCH && (!best || sim > best.sim)) best = { h, sim };
      }
      if (!best) continue;
      row.cells[colId] = { state: best.sim >= SAME ? 'present' : 'renamed', index: best.h.index, text: best.h.text, moved: true };
      left.splice(left.indexOf(best.h), 1);
    }
  }
  // Row cells name headings by their place in the full list, for jumping.
  for (const row of rows) {
    row.heading = base[row.index].index;
    for (const [colId, cell] of Object.entries(row.cells)) {
      if (Number.isInteger(cell.index)) cell.heading = sections[colId][cell.index].index;
    }
  }
  // Sections no base has: one row each, with the other columns that have a
  // section of the same name marked too, so it is listed once.
  const extras = [];
  const taken = new Set();
  for (const col of columns) {
    for (const h of extra[col.id] || []) {
      const key = `${col.id}:${h.index}`;
      if (taken.has(key)) continue;
      taken.add(key);
      const cells = { [baseId]: { state: 'missing' } };
      for (const other of columns) {
        if (other.id === baseId) continue;
        if (other.id === col.id) {
          cells[other.id] = { state: 'present', heading: sections[col.id][h.index].index };
          continue;
        }
        if (!sections[other.id]) continue;
        let best = null;
        for (const o of extra[other.id] || []) {
          const sim = similarity(h.text, o.text);
          if (sim >= MATCH && !taken.has(`${other.id}:${o.index}`) && (!best || sim > best.sim)) best = { o, sim };
        }
        if (best) {
          taken.add(`${other.id}:${best.o.index}`);
          cells[other.id] = { state: best.sim >= SAME ? 'present' : 'renamed', heading: sections[other.id][best.o.index].index, text: best.o.text };
        } else {
          cells[other.id] = { state: 'missing' };
        }
      }
      extras.push({ text: h.text, owner: col.id, cells });
    }
  }
  const coverage = [];
  for (const col of columns) {
    if (col.id === baseId || !sections[col.id]) continue;
    let present = 0;
    let renamed = 0;
    for (const row of rows) {
      const state = row.cells[col.id]?.state;
      if (state === 'present') present += 1;
      if (state === 'renamed') renamed += 1;
    }
    const adds = extras.filter((row) => row.cells[col.id]?.state !== 'missing').length;
    coverage.push({ colId: col.id, covered: present + renamed, renamed, adds, total: rows.length });
  }
  return { rows, extras, coverage, unreadable: columns.filter((c) => c.id !== baseId && !sections[c.id]).map((c) => c.id) };
}

function cellHtml(cell, set, colId) {
  if (!cell) return `<td data-col="${colId}"><span class="na" aria-label="Not available">&#8211;</span></td>`;
  if (cell.state === 'present') return `<td class="ok" data-col="${colId}"><span class="secmap__ok" role="img" aria-label="Present">${icon('check')}</span></td>`;
  if (cell.state === 'renamed') return `<td data-col="${colId}"><span class="ren" title="${escHtml(cell.text || '')}">Renamed</span></td>`;
  return `<td data-col="${colId}"><span class="miss">Missing</span></td>`;
}

/**
 * Draw the panel body.
 *
 * @param {HTMLElement} host `.panel__body`
 * @param {object} set
 * @param {string} baseId
 * @param {(colId: string) => Array|null} headingsOf
 */
export function renderSections(host, set, baseId, headingsOf) {
  const columns = displayColumns(set).filter((col) => col.source);
  const base = nameOf(set, baseId);
  if (!baseId || !headingsOf(baseId)) {
    host.innerHTML = `<p class="panel__intro">Sections appear once the base column, ${escHtml(base.ref)}, has a report with headings in it.</p>`;
    host.dataset.sig = '';
    return null;
  }
  const data = buildSections(baseId, columns, headingsOf);
  host.sectionData = data;
  const sig = JSON.stringify([baseId, set.view.blind, columns.map((c) => c.id), data.rows.map((r) => [r.text, r.cells]), data.extras.map((r) => [r.text, r.cells])]);
  if (host.dataset.sig === sig) return data;
  const hadFocus = host.contains(document.activeElement) ? document.activeElement.dataset.row : null;
  host.dataset.sig = sig;

  const headCells = columns.map((col) => {
    const name = nameOf(set, col);
    return `<th scope="col" data-col="${col.id}" data-role="${roleAttr(set, col)}"><span class="rb rb--sm" aria-hidden="true">${escHtml(name.mark)}</span>`
      + `<span class="visually-hidden">${escHtml(name.blind ? name.label : `${name.ref}, ${col.label}`)}</span></th>`;
  }).join('');
  const rowHtml = (row, i) => {
    const renamedIn = columns.filter((col) => row.cells[col.id]?.state === 'renamed')
      .map((col) => `${escHtml(nameOf(set, col).ref)} calls it "${escHtml(row.cells[col.id].text)}"`);
    const sub = renamedIn.length ? `<span class="sub">${renamedIn.join('; ')}</span>` : '';
    const cells = columns.map((col) => cellHtml(col.id === baseId ? { state: 'present' } : row.cells[col.id], set, col.id)).join('');
    return `<tr data-row="${i}"><th scope="row"><button type="button" data-action="cmp-section" data-row="${i}">${escHtml(row.text)}${sub}</button></th>${cells}</tr>`;
  };
  const extraHtml = (row, i) => {
    const cells = columns.map((col) => cellHtml(row.cells[col.id], set, col.id)).join('');
    return `<tr data-extra="${i}"><th scope="row"><button type="button" data-action="cmp-section" data-extra="${i}">${escHtml(row.text)}`
      + `<span class="sub">Only in ${escHtml(nameOf(set, row.owner).ref)}</span></button></th>${cells}</tr>`;
  };
  const coverage = data.coverage.map((c) => {
    const who = `<b>${escHtml(nameOf(set, c.colId).ref)}</b>`;
    if (!c.total) return c.adds ? `<p>${who} has ${c.adds} section${c.adds === 1 ? '' : 's'} the base does not.</p>` : '';
    const of = c.covered === c.total ? `all ${c.total}` : `${c.covered} of ${c.total}`;
    const renamed = c.renamed ? ` (${c.renamed} under another name)` : '';
    const adds = c.adds ? ` and adds ${c.adds}` : '';
    return `<p>${who} covers ${of} base section${c.total === 1 ? '' : 's'}${renamed}${adds}.</p>`;
  }).join('');
  const unreadable = data.unreadable.map((id) => `<p><b>${escHtml(nameOf(set, id).ref)}</b> runs its own scripts, so its headings cannot be read.</p>`).join('');

  // A base with no sections still shows the sections only other columns
  // have: those rows used to go with the table.
  const none = data.rows.length ? '' : `<p class="panel__intro">${escHtml(base.ref)} has no section headings to line up${data.extras.length ? ', so every section below is in another column only' : ''}.</p>`;
  host.innerHTML = `
    <p class="panel__intro">Rows follow ${escHtml(base.ref)}, the base. Select a row to bring that section to the reading line in every column.</p>
    ${none}
    ${data.rows.length || data.extras.length ? `<table class="secmap">
      <thead><tr><th scope="col">Section in ${escHtml(base.ref)}</th>${headCells}</tr></thead>
      <tbody>${data.rows.map(rowHtml).join('')}
      ${data.extras.length ? `<tr class="group"><td colspan="${columns.length + 1}">Only in other columns</td></tr>${data.extras.map(extraHtml).join('')}` : ''}
      </tbody></table>` : ''}
    <div class="coverage">${coverage}${unreadable}<p>Matched by heading text, not by meaning.</p></div>
    <p class="legend"><span>${icon('check')}Present</span><span><span class="ren">Renamed</span>similar heading</span><span class="miss">Missing</span></p>
    <div class="panel__foot"><p>Changing the base column changes every row.</p></div>`;
  if (hadFocus !== undefined && hadFocus !== null) host.querySelector(`[data-action="cmp-section"][data-row="${hadFocus}"]`)?.focus({ preventScroll: true });
  return data;
}

/** Mark the row of the section at the top of the column being read. */
export function markSectionRow(host, rowIndex) {
  for (const tr of host.querySelectorAll('.secmap tbody tr[data-row]')) {
    const here = Number(tr.dataset.row) === rowIndex;
    tr.classList.toggle('is-here', here);
    const button = tr.querySelector('button');
    if (here) button?.setAttribute('aria-current', 'location');
    else button?.removeAttribute('aria-current');
  }
}
