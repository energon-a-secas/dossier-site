/**
 * The report library: saving, listing, opening and deleting.
 *
 * Split out of js/events.js when that file crossed the fleet's 500 line cap.
 * The boundary is real rather than arbitrary: everything here talks to
 * js/store.js and nothing here knows about a click.
 */

import { showToast } from './neorgon-dom.js';
import { applyDocument } from './pipeline.js';
import { reportOf } from './render/index.js';
import { setPreference } from './state.js';
import { listReports, readReport, writeReport, deleteReport, estimateUsage } from './store.js';

// ── Storage ──────────────────────────────────────────────────────────────────

export async function persistCurrent(state, els) {
  const report = reportOf(state.model);
  if (!report) return;
  const id = state.reportId || `r-${Date.now().toString(36)}`;
  const meta = {
    id,
    title: report.title || 'Untitled report',
    kind: report.kind || null,
    status: report.status || null,
    pages: (report.pages || []).length,
    updated: new Date().toISOString(),
  };
  const ok = await writeReport(id, state.document, meta);
  if (ok === false) {
    const usage = await estimateUsage();
    showToast(usage && usage.pct
      ? `Could not save: storage is about ${Math.round(usage.pct)}% full. This session still works.`
      : 'Could not save this report. This session still works.');
    return;
  }
  state.reportId = id;
  setPreference(state, 'lastReportId', id);
  refreshLibrary(state, els);
}

export async function refreshLibrary(state, els) {
  if (!els.library) return;
  const items = (await listReports()) || [];
  els.library.replaceChildren();

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'ds-library__empty';
    li.textContent = 'No reports saved here yet.';
    els.library.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'ds-library__item';
    if (item.id === state.reportId) li.setAttribute('aria-current', 'true');

    const open = document.createElement('button');
    open.type = 'button';
    open.dataset.action = 'open-report';
    open.dataset.reportId = item.id;
    open.className = 'ds-library__open';
    open.innerHTML = '';
    const title = document.createElement('span');
    title.className = 'ds-library__title';
    title.textContent = item.title || 'Untitled report';
    const meta = document.createElement('span');
    meta.className = 'ds-library__meta';
    meta.textContent = [item.kind, item.pages ? `${item.pages} pages` : null]
      .filter(Boolean).join(' · ');
    open.append(title, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'delete-report';
    remove.dataset.reportId = item.id;
    remove.className = 'ds-library__delete';
    remove.setAttribute('aria-label', `Delete ${item.title || 'this report'}`);
    remove.textContent = 'Delete';

    li.append(open, remove);
    els.library.appendChild(li);
  }
}

export function filterLibrary(els, query) {
  const needle = String(query || '').trim().toLowerCase();
  for (const li of els.library?.children || []) {
    const text = li.textContent.toLowerCase();
    li.hidden = Boolean(needle) && !text.includes(needle);
  }
}

export async function openStored(state, els, id, finishOpen) {
  if (!id) return;
  const record = await readReport(id);
  if (!record || !record.document) {
    showToast('That report could not be read back. Nothing was changed.');
    return;
  }
  applyDocument(state, record.document);
  state.reportId = id;
  setPreference(state, 'lastReportId', id);
  if (typeof finishOpen === "function") finishOpen(state, els);
}

export async function removeStored(state, els, id) {
  if (!id) return;
  await deleteReport(id);
  if (state.reportId === id) {
    state.reportId = null;
    setPreference(state, 'lastReportId', null);
  }
  refreshLibrary(state, els);
}
