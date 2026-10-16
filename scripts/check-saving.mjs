/**
 * Browser regressions for saving, run by scripts/check-workspace.mjs: edits
 * made just before a reload survive it, two tabs on one report or comparison
 * keep both tabs' edits, a review note typed just before Back stays in its
 * own comparison, and saving recovers after the site's data is cleared
 * under an open tab. Each check opens its own browser context, so nothing is
 * left in the shared profile.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AGENT_MD = path.join(root, 'reports/compare/agent-output.md');

/** A report with two paragraphs, so two tabs can each edit one. */
const TWO_PARAGRAPHS = {
  dossier: {
    version: 1,
    title: 'Two tabs, one report',
    pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'Paragraph one, original.' }, { type: 'prose', text: 'Paragraph two, original.' }] }],
  },
};

const STEPS = {
  reportEditSurvivesReload,
  reportsInTwoTabs,
  queuedSavesAllChecked,
  compareSurvivesReload,
  compareInTwoTabs,
  noteStaysInItsComparison,
  savingAfterStorageCleared,
};

/** @param {{only?: string}} opts only: run one step by name, while working on it */
export async function checkSaving({ browser, base, errors, only }) {
  for (const [name, step] of Object.entries(STEPS)) {
    if (!only || only === name) await step({ browser, base, errors });
  }
}

async function freshContext(browser, options = {}) {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
}

async function open(context, base, errors, label, hash = '') {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  await page.goto(`${base}/?check=${label}${hash}`, { waitUntil: 'networkidle' });
  return page;
}

/** Open a pasted report in a page and wait until it is saved. */
async function pasteReport(page, doc) {
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(JSON.stringify(doc));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.locator('#stage .report-title').filter({ hasText: doc.dossier.title }).waitFor();
  await page.waitForFunction(() => document.getElementById('reportOrigin').textContent === 'Saved in this browser');
}

/** The stored report's paragraphs, read from IndexedDB in the page. */
function storedParagraphs(page) {
  return page.evaluate(async () => {
    const { listReports, readReport } = await import('/js/store.js');
    const [row] = await listReports();
    const record = row ? await readReport(row.id) : null;
    return record ? record.document.dossier.pages[0].blocks.map((b) => b.text) : null;
  });
}

/** Into the JSON editor, and type a new version of the document there. */
async function editJson(page, change) {
  if ((await page.locator('#toggleMode').getAttribute('aria-pressed')) !== 'true') await page.locator('#toggleMode').click();
  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  const doc = JSON.parse(await page.locator('.editor-textarea').inputValue());
  change(doc);
  await page.locator('.editor-textarea').fill(JSON.stringify(doc, null, 2));
}

/** Edits made in the last moment before a reload used to be lost (R5). */
async function reportEditSurvivesReload({ browser, base, errors }) {
  const context = await freshContext(browser);
  const page = await open(context, base, errors, 'save-reload');
  await pasteReport(page, TWO_PARAGRAPHS);
  await editJson(page, (doc) => { doc.dossier.pages[0].blocks[0].text = 'Edited just before the reload.'; });
  // 50 ms: the editor has not even parsed yet (it waits 200 ms).
  await page.waitForTimeout(50);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#stage .report-title').waitFor();
  assert.deepEqual(await storedParagraphs(page), ['Edited just before the reload.', 'Paragraph two, original.'], 'An edit made 50 ms before a reload was lost');
  assert.match(await page.locator('#stage').innerText(), /Edited just before the reload\./, 'The reloaded report does not show the edit');
  assert.equal(await page.evaluate(() => localStorage.getItem('dossier-site:reports-journal')), null, 'The journal was left behind after its replay');
  await context.close();
}

/**
 * Two tabs on one report (R6). A tab with nothing waiting shows the other
 * tab's save at once, so its next edit builds on it. A tab that was busy
 * when the other saved is told, and chooses, rather than writing over it.
 */
async function reportsInTwoTabs({ browser, base, errors }) {
  const context = await freshContext(browser);
  const a = await open(context, base, errors, 'tabs-a');
  await pasteReport(a, TWO_PARAGRAPHS);
  const b = await open(context, base, errors, 'tabs-b');
  await b.locator('#stage .report-title').filter({ hasText: 'Two tabs, one report' }).waitFor();

  // A edits paragraph one; B, only reading, shows it once A's save lands.
  await editJson(a, (doc) => { doc.dossier.pages[0].blocks[0].text = 'Edited in tab A.'; });
  // Out of the editor, so A is not busy when B saves.
  await a.locator('.editor-textarea').blur();
  await b.waitForFunction(() => /Edited in tab A\./.test(document.getElementById('stage').textContent), null, { timeout: 4000 })
    .catch(() => assert.fail('Tab B kept showing the old text after tab A saved'));
  assert.match(await b.locator('#app-toast').innerText(), /changed in another tab/);
  // B's own edit, of paragraph two, keeps A's change.
  await editJson(b, (doc) => { doc.dossier.pages[0].blocks[1].text = 'Edited in tab B.'; });
  await b.locator('.editor-textarea').blur();
  await b.waitForTimeout(700);
  assert.deepEqual(await storedParagraphs(b), ['Edited in tab A.', 'Edited in tab B.'], 'Tab B saved over tab A\'s edit');

  // Now B is busy in the editor when A saves: B's next save is refused, and
  // a notice offers the choice. Keep mine saves B's version on purpose.
  await a.waitForFunction(() => /Edited in tab B\./.test(document.getElementById('stage').textContent), null, { timeout: 4000 });
  await b.locator('.editor-textarea').focus();
  await editJson(a, (doc) => { doc.dossier.pages[0].blocks[0].text = 'A again.'; });
  await a.waitForTimeout(700);
  await editJson(b, (doc) => { doc.dossier.pages[0].blocks[1].text = 'B again, on an old copy.'; });
  await b.locator('#reportConflict').waitFor({ timeout: 4000 }).catch(() => assert.fail('A refused save showed no notice'));
  assert.deepEqual(await storedParagraphs(b), ['A again.', 'Edited in tab B.'], 'A save made on an old copy was written');
  assert.match(await b.locator('#reportConflict').innerText(), /changed in another tab/);
  await b.locator('#reportConflict [data-action="report-keep-mine"]').click();
  await b.locator('#reportConflict').waitFor({ state: 'detached' });
  await b.waitForTimeout(300);
  assert.deepEqual(await storedParagraphs(b), ['Edited in tab A.', 'B again, on an old copy.'], 'Keep mine did not save this tab\'s version');
  await context.close();
}

/**
 * Two saves queued at once, after another tab saved the report: both are
 * refused. The second used to run with no revision to check at all once the
 * first was refused, and wrote over the other tab's version.
 */
async function queuedSavesAllChecked({ browser, base, errors }) {
  const context = await freshContext(browser);
  const page = await open(context, base, errors, 'queued');
  await pasteReport(page, TWO_PARAGRAPHS);
  const outcomes = await page.evaluate(async () => {
    const store = await import('/js/store.js');
    const { state } = await import('/js/state.js');
    const { persistCurrent } = await import('/js/library.js');
    // Another tab's save, behind this tab's back (no notice reaches it).
    const record = await store.readReport(state.reportId);
    record.document.dossier.pages[0].blocks[0].text = 'Saved by another tab.';
    await store.writeReport(state.reportId, record.document, record.meta);
    const els = { library: document.getElementById('library'), stage: document.getElementById('stage') };
    return Promise.all([persistCurrent(state, els), persistCurrent(state, els)]);
  });
  assert.deepEqual(outcomes, ['conflict', 'conflict'], 'A save queued behind a refused one was written');
  assert.deepEqual(await storedParagraphs(page), ['Saved by another tab.', 'Paragraph two, original.']);
  await context.close();
}

/** Seed a saved comparison in the page, with the Review panel open. */
function seedSet(page, spec) {
  return page.evaluate(async ({ id, title, notes }) => {
    const model = await import('/js/compare/model.js');
    const store = await import('/js/compare/store.js');
    let set = model.newSet({ id, title });
    set = model.addColumn(set, { role: 'human', label: 'Human draft', source: { kind: 'text', name: 'a.txt', text: `${title}: the human draft.` } }).set;
    set = model.addColumn(set, { role: 'agent', label: 'Agent output', source: { kind: 'text', name: 'b.txt', text: `${title}: the agent output.` } }).set;
    set = model.setView(set, { panel: 'review' });
    set = { ...set, review: { ...set.review, notes: notes || {} } };
    return Boolean(await store.writeSet(set));
  }, spec);
}

function storedSet(page, id) {
  return page.evaluate(async (setId) => (await import('/js/compare/store.js')).readSet(setId), id);
}

async function openSet(page, id) {
  await page.evaluate((setId) => { location.hash = `#/~compare/${setId}`; }, id);
  await page.waitForFunction((setId) => location.hash.endsWith(setId) && document.querySelector('#cmpPanel textarea[data-note="k1"]'), id);
}

/** A note typed just before a reload, and a report put into a new comparison (R5). */
async function compareSurvivesReload({ browser, base, errors }) {
  const context = await freshContext(browser);
  const page = await open(context, base, errors, 'cmp-reload');
  assert.ok(await seedSet(page, { id: 'c-reload-note', title: 'Reload check' }));
  await openSet(page, 'c-reload-note');
  await page.locator('#cmpPanel textarea[data-note="k1"]').fill('Typed 50 ms before the reload.');
  await page.waitForTimeout(50);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#cmpPanel textarea[data-note="k1"]').waitFor();
  assert.equal((await storedSet(page, 'c-reload-note'))?.review.notes.k1, 'Typed 50 ms before the reload.', 'A note typed 50 ms before a reload was not saved');
  assert.equal(await page.locator('#cmpPanel textarea[data-note="k1"]').inputValue(), 'Typed 50 ms before the reload.');

  // A new comparison: a report chosen into column A, then a reload 100 ms on.
  await page.evaluate(() => { location.hash = '#/~compare'; });
  await page.locator('#compareView [data-action="cmp-new-set"], #cmpSwitcherBtn').first().waitFor();
  await page.evaluate(async () => (await import('/js/compare/index.js')).api.openSet((await import('/js/compare/model.js')).blankSet(), { saved: false }));
  const before = await page.evaluate(async () => (await (await import('/js/compare/store.js')).listSets()).length);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#cmp-col-k1 [data-action="cmp-choose-file"]').click(),
  ]);
  await chooser.setFiles(AGENT_MD);
  await page.locator('#cmp-col-k1 .col__scroll').first().waitFor();
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'networkidle' });
  const after = await page.evaluate(async () => (await (await import('/js/compare/store.js')).listSets()).length);
  assert.equal(after, before + 1, 'A report put into a new comparison 100 ms before a reload was not saved');
  await context.close();
}

/** Two tabs on one comparison: a note in one and a mark in the other both stay (R6). */
async function compareInTwoTabs({ browser, base, errors }) {
  const context = await freshContext(browser);
  const a = await open(context, base, errors, 'cmp-tabs-a');
  assert.ok(await seedSet(a, { id: 'c-two-tabs', title: 'Two tabs' }));
  await openSet(a, 'c-two-tabs');
  const b = await open(context, base, errors, 'cmp-tabs-b', '#/~compare/c-two-tabs');
  await b.locator('#cmpPanel textarea[data-note="k1"]').waitFor();
  await a.locator('#cmpPanel textarea[data-note="k1"]').fill('A note from tab A.');
  await b.waitForTimeout(300);
  await b.locator('#cmpPanel [data-action="cmp-mark"][data-col="k2"][data-value="strong"]').first().click();
  await a.waitForTimeout(1500);
  const stored = await storedSet(a, 'c-two-tabs');
  assert.equal(stored.review.notes.k1, 'A note from tab A.', 'Tab B saved over tab A\'s note');
  assert.ok(Object.values(stored.review.marks).some((row) => row.k2 === 'strong'), 'Tab A saved over tab B\'s mark');
  for (const [name, page] of [['A', a], ['B', b]]) {
    assert.equal(await page.locator('#cmpPanel textarea[data-note="k1"]').inputValue(), 'A note from tab A.', `Tab ${name} does not show the note`);
    assert.equal(await page.locator('#cmpPanel [data-action="cmp-mark"][data-col="k2"][data-value="strong"][aria-checked="true"]').count() >= 1, true, `Tab ${name} does not show the mark`);
  }
  await context.close();
}

/**
 * A note and summary typed in set A and then Back to set B land in A, and
 * B's own note is untouched and shown (R7). Twice: inside the note's wait,
 * and well after it with focus still in the field.
 */
async function noteStaysInItsComparison({ browser, base, errors }) {
  for (const wait of [30, 1500]) {
    const context = await freshContext(browser);
    const page = await open(context, base, errors, `cmp-back-${wait}`);
    assert.ok(await seedSet(page, { id: 'c-set-b', title: 'Set B', notes: { k1: 'B own note, written earlier.' } }));
    assert.ok(await seedSet(page, { id: 'c-set-a', title: 'Set A' }));
    await openSet(page, 'c-set-b');
    await openSet(page, 'c-set-a');
    await page.locator('#cmpPanel textarea[data-summary]').fill('Summary meant for set A.');
    await page.locator('#cmpPanel textarea[data-note="k1"]').fill('Note meant for set A.');
    await page.waitForTimeout(wait);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.hash.endsWith('c-set-b'));
    await page.waitForTimeout(700);
    const a = await storedSet(page, 'c-set-a');
    const b = await storedSet(page, 'c-set-b');
    assert.equal(a.review.notes.k1, 'Note meant for set A.', `${wait} ms: set A lost its note`);
    assert.equal(a.review.summary, 'Summary meant for set A.', `${wait} ms: set A lost its summary`);
    assert.equal(b.review.notes.k1, 'B own note, written earlier.', `${wait} ms: set B's note was replaced`);
    assert.equal(b.review.summary, '', `${wait} ms: set A's summary landed in set B`);
    assert.equal(await page.locator('#cmpPanel textarea[data-note="k1"]').inputValue(), 'B own note, written earlier.', `${wait} ms: set B's note field does not show its note`);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.matches('textarea[data-note], textarea[data-summary]'))), false, `${wait} ms: focus was carried into set B's review`);
    await context.close();
  }
}

/** Saving recovers when the site's data is cleared under an open tab (R44). */
async function savingAfterStorageCleared({ browser, base, errors }) {
  const clear = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'indexeddb' });
    await cdp.detach();
    await page.waitForTimeout(100);
  };

  // A comparison.
  const context = await freshContext(browser);
  const page = await open(context, base, errors, 'cleared');
  assert.ok(await seedSet(page, { id: 'c-cleared', title: 'Cleared' }));
  await openSet(page, 'c-cleared');
  await page.locator('#cmpPanel textarea[data-note="k1"]').fill('Before the clear.');
  await page.waitForTimeout(800);
  await clear(page);
  await page.locator('#cmpPanel textarea[data-note="k1"]').fill('After the clear.');
  await page.waitForTimeout(800);
  assert.equal((await storedSet(page, 'c-cleared'))?.review.notes.k1, 'After the clear.', 'A comparison edited after the clear was not saved');
  assert.doesNotMatch(await page.locator('#app-toast').innerText(), /could not be saved/, 'Saving said it failed after the clear');

  // A report: the edit is saved, and the list shows only what is stored.
  await page.evaluate(() => { location.hash = '#/'; });
  await pasteReport(page, TWO_PARAGRAPHS);
  await clear(page);
  await editJson(page, (doc) => { doc.dossier.pages[0].blocks[0].text = 'Edited after the clear.'; });
  await page.waitForTimeout(900);
  assert.deepEqual(await storedParagraphs(page), ['Edited after the clear.', 'Paragraph two, original.'], 'A report edited after the clear was not saved');
  assert.deepEqual(await page.locator('#library .ds-library__title').allInnerTexts(), ['Two tabs, one report'], 'The rail lists reports that are no longer stored');
  await context.close();

  // An address naming a comparison this browser does not have says what is open.
  const fresh = await freshContext(browser);
  const missing = await open(fresh, base, errors, 'missing', '#/~compare/c-no-such-set');
  await missing.waitForFunction(() => /not saved in this browser/.test(document.getElementById('app-toast')?.textContent || ''));
  assert.match(await missing.locator('#app-toast').innerText(), /so a new comparison is open instead\./, 'The missing comparison message names the wrong thing');
  await fresh.close();
}
