/**
 * Browser checks for where focus goes in the Compare view's chrome: the side
 * panel lying over the columns (it takes focus, and closes when Tab reaches
 * a column under it), the Review panel's sticky head and foot (no focused
 * control under them), the undo toast (it waits while the reader is on it,
 * Escape and expiry put focus somewhere real, and the page's status toast
 * moves above it), the Review sheet on a phone (Tab reaches every control),
 * and a write that fails under a rename or an undo.
 *
 * Run by scripts/check-compare.mjs at its end, or alone:
 * `node scripts/check-compare-focus.mjs` (DOSSIER_URL overrides
 * http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { base, watch, focusOn } from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];

/** The bundled example, from the Open dialog, with its marks drawn. */
async function openExample(page) {
  await page.locator('#openReport').click();
  await page.locator('#openExamples [data-action="cmp-example"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 3);
  await page.locator('#cmp-col-k3 .ruler').waitFor();
}

async function freshPage(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=focus-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  return { context, page };
}

/** What has focus, and whether it shows at its centre (not under something). */
function focusState(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { body: true };
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const desc = (n) => (n ? `${n.localName}${n.id ? `#${n.id}` : ''}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).join('.')}` : ''}` : 'nothing');
    return {
      body: false,
      name: (el.getAttribute('aria-label') || el.textContent || el.id || el.localName).replace(/\s+/g, ' ').trim().slice(0, 60),
      action: el.dataset?.action || '',
      sticky: Boolean(el.closest('.panel__head, .panel__foot')),
      inPanel: Boolean(el.closest('#cmpPanel')),
      shows: el === hit || el.contains(hit),
      hit: desc(hit),
      inView: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    };
  });
}

/**
 * From Close review to Copy review and back: every stop outside the sticky
 * head and foot shows at its centre. The panel used to let focus scroll a
 * control under its 87 px foot (WCAG 2.4.11).
 */
async function walkReview(page, label) {
  await page.locator('#cmpPanel [data-action="cmp-close-panel"]').focus();
  for (const [key, end] of [['Tab', 'cmp-copy-review'], ['Shift+Tab', 'cmp-close-panel']]) {
    let reached = false;
    for (let i = 0; i < 80 && !reached; i += 1) {
      await page.keyboard.press(key);
      const at = await focusState(page);
      assert.ok(at.inPanel, `${label}: ${key} ${i + 1} left the Review panel for ${at.name}`);
      if (!at.sticky) assert.ok(at.shows, `${label}: ${key} put focus on "${at.name}" under ${at.hit}`);
      reached = at.action === end;
    }
    assert.ok(reached, `${label}: ${key} never reached ${end}`);
  }
}

/** Remove the first criterion from its menu: focus lands on Add criterion, in sight. */
async function removeCriterion(page, label) {
  // By the keyboard: a pointer click lets Playwright scroll the page first.
  await page.locator('#cmpPanel .crit__more').first().focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'cmp-crit-remove', `${label}: End in the criterion menu is not Remove criterion`);
  await page.keyboard.press('Enter');
  await focusOn(page, '#cmpPanel [data-action="cmp-crit-add"]', `${label}: Remove criterion moved focus elsewhere`);
  const at = await focusState(page);
  assert.ok(at.shows, `${label}: Add criterion took focus under ${at.hit}`);
  assert.equal(await page.evaluate(() => scrollY), 0, `${label}: focusing Add criterion scrolled the page`);
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('#cmpToast.is-visible'));
}

/** Tab (at most 40 times) until the undo toast's button has focus. */
async function tabToUndo(page, label) {
  for (let i = 0; i < 40; i += 1) {
    if (await page.evaluate(() => document.activeElement?.closest?.('#cmpToast') !== null && document.activeElement?.localName === 'button')) return i;
    await page.keyboard.press('Tab');
  }
  assert.fail(`${label}: Tab never reached Undo`);
}

/** Intersection of two rects, as an area. */
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The page's status toast never covers the undo toast or its Undo. */
async function toastsApart(page, label) {
  await page.evaluate(async () => (await import('/js/share.js')).say('A status message, for the toast check.'));
  await page.waitForTimeout(450);
  const boxes = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect().toJSON();
    return { app: r(document.getElementById('app-toast')), undo: r(document.getElementById('cmpToast')), button: r(document.querySelector('#cmpToast button')) };
  });
  assert.equal(overlap(boxes.app, boxes.undo), 0, `${label}: the status toast (${JSON.stringify(boxes.app)}) covers the undo toast (${JSON.stringify(boxes.undo)})`);
  const cx = boxes.button.left + boxes.button.width / 2;
  const cy = boxes.button.top + boxes.button.height / 2;
  assert.ok(!(cx >= boxes.app.left && cx <= boxes.app.right && cy >= boxes.app.top && cy <= boxes.app.bottom), `${label}: Undo's centre is under the status toast`);
}

try {
  // ── The panel over the columns, its sticky bars, at 1440 and 1024 ──────────
  const { context, page } = await freshPage({ width: 1440, height: 900 });
  await openExample(page);
  assert.ok(await page.evaluate(() => !document.getElementById('compareView').classList.contains('panel-docked')));
  // Opened from its toggle by the keyboard, the panel lying over the columns
  // takes focus: left on the toggle, the next 17 Tabs went through columns
  // hidden under it.
  const reviewToggle = page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="review"]');
  assert.equal(await reviewToggle.getAttribute('aria-controls'), 'cmpPanel');
  await reviewToggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('compareView').classList.contains('panel-overlay'));
  assert.ok(await page.evaluate(() => document.getElementById('cmpPanel').contains(document.activeElement)), 'The Review panel over the columns did not take focus');
  const pad = await page.evaluate(() => {
    const panel = document.getElementById('cmpPanel');
    return { foot: panel.style.getPropertyValue('--panel-foot-h'), padding: getComputedStyle(panel).scrollPaddingBottom };
  });
  assert.match(pad.foot, /^\d+px$/, 'The Review foot was not measured');
  assert.ok(parseFloat(pad.padding) >= parseFloat(pad.foot), `The panel's scroll padding (${pad.padding}) is shorter than its foot (${pad.foot})`);
  await walkReview(page, 'Review at 1440');
  await removeCriterion(page, 'Review at 1440');

  // Shift+Tab out of the panel reaches column C under it: the panel closes
  // and focus stays there, now in sight.
  await page.locator('#cmpPanel .panel__body summary').first().focus();
  let left = false;
  for (let i = 0; i < 10 && !left; i += 1) {
    await page.keyboard.press('Shift+Tab');
    left = await page.evaluate(() => !document.getElementById('cmpPanel').contains(document.activeElement));
  }
  assert.ok(left, 'Shift+Tab never left the panel');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'The panel stayed over the column Shift+Tab reached');
  assert.equal(await page.evaluate(() => document.getElementById('compareView').classList.contains('panel-overlay')), false);
  assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('#cmp-col-k3'))), 'Shift+Tab out of the panel did not land in column C');
  const landed = await focusState(page);
  assert.ok(landed.shows, `Focus in column C is under ${landed.hit}`);
  // A click on the part of a column that shows leaves the panel open.
  await reviewToggle.click();
  await page.locator('#cmpPanel .panel__body').waitFor();
  await page.locator('#cmp-col-k1 .col__scroll').click({ position: { x: 60, y: 120 } });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#cmpPanel').isVisible(), true, 'A click in column A closed the panel');

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);
  await walkReview(page, 'Review at 1024');
  await removeCriterion(page, 'Review at 1024');
  await page.locator('#cmpPanel [data-action="cmp-close-panel"]').click();
  await focusOn(page, '.cmp-toolbar [data-action="cmp-panel"][data-panel="review"], #cmpOptionsBtn', 'Closing the panel lost focus');

  // ── The undo toast waits while the reader is on it ─────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.locator('#cmp-col-k1 .col__menu').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'cmp-remove');
  await page.keyboard.press('Enter');
  await page.locator('#cmpToast.is-visible button').waitFor();
  assert.equal(await page.locator('#cmp-col-k1').count(), 0);
  // The removal puts focus on the next column's menu a frame later.
  await focusOn(page, '#compareView .col__menu', 'Remove column left focus nowhere');
  await tabToUndo(page, 'Remove column');
  // Ten seconds is the most it shows on its own; held, it is still there.
  await page.waitForTimeout(10500);
  assert.ok(await page.locator('#cmpToast').evaluate((el) => el.classList.contains('is-visible')), 'The undo toast went away while Undo had focus');
  assert.ok(await page.evaluate(() => document.activeElement?.textContent === 'Undo'), 'Focus left Undo');
  // The status toast moves above it.
  await toastsApart(page, 'At 1440');
  // Away and back: it is still there, and Undo works from the keyboard.
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#cmpToast').evaluate((el) => el.classList.contains('is-visible')), 'Leaving Undo hid the toast at once');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.locator('#cmp-col-k1').waitFor();
  await page.waitForFunction(() => !document.querySelector('#cmpToast.is-visible'));
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--toast-lift')), '', 'The lift outlived the undo toast');
  // Escape on Undo hides the toast and puts focus on a control on screen. A
  // column removed from its menu used to leave focus on <body> here.
  await page.locator('#cmp-col-k2 .col__menu').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.locator('#cmpToast.is-visible button').waitFor();
  await focusOn(page, '#compareView .col__menu', 'Remove column B left focus nowhere');
  await tabToUndo(page, 'Remove column B');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#cmpToast.is-visible'));
  const back = await focusState(page);
  assert.ok(!back.body && back.inView, `Escape on Undo left focus on ${back.body ? 'the page' : back.name}`);
  // The pointer over it holds it too, and once the pointer leaves it runs
  // out after at least four seconds.
  await page.evaluate(async () => (await import('/js/compare/popover.js')).undoToast(document.getElementById('cmpToast'), 'A hover check.', () => null, 1200));
  await page.locator('#cmpToast').hover();
  await page.waitForTimeout(2000);
  assert.ok(await page.locator('#cmpToast').evaluate((el) => el.classList.contains('is-visible')), 'The undo toast went away under the pointer');
  await page.mouse.move(40, 300);
  await page.waitForTimeout(4600);
  assert.equal(await page.locator('#cmpToast').evaluate((el) => el.classList.contains('is-visible')), false, 'The undo toast never ran out once the pointer left');

  // A status message under a column's own form actions: "Start from a copy"
  // says "Edit it, then Save" while the editor's Save sits in that corner.
  await openExample(page);
  await page.locator('.cmp-toolbar [data-action="cmp-add-menu"]').click();
  await page.locator('#cmpAddMenu [data-action="cmp-add-column"][data-role="fix"]').click();
  await page.locator('#cmp-col-k4 [data-action="cmp-copy-from"]').click();
  await page.locator('#cmp-col-k4 form').waitFor();
  await page.waitForTimeout(400);
  const formBoxes = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect().toJSON();
    const toast = document.getElementById('app-toast');
    return {
      visible: toast.classList.contains('visible'),
      toast: r(toast),
      actions: [...document.querySelectorAll('#cmp-col-k4 form .col-form__actions button')].map(r),
    };
  });
  assert.ok(formBoxes.visible && formBoxes.actions.length >= 2, 'The copy said nothing, or its form has no actions');
  for (const box of formBoxes.actions) assert.equal(overlap(box, formBoxes.toast), 0, `The status toast covers the copy's form actions (${JSON.stringify(box)})`);
  await context.close();

  // ── On a phone the toasts stack too ────────────────────────────────────────
  const phone = await freshPage({ width: 1440, height: 900 });
  await openExample(phone.page);
  await phone.page.setViewportSize({ width: 390, height: 844 });
  await phone.page.waitForTimeout(300);
  await phone.page.evaluate(async () => (await import('/js/compare/popover.js')).undoToast(document.getElementById('cmpToast'), 'Column A removed.', () => null, 20000));
  await toastsApart(phone.page, 'At 390');
  await phone.page.evaluate(async () => (await import('/js/compare/popover.js')).hideToast(document.getElementById('cmpToast'), { refocus: false }));

  // ── The Review sheet keeps Tab, and Tab reaches every control in it ────────
  for (const size of [{ width: 390, height: 844 }, { width: 640, height: 720 }]) {
    const label = `Review sheet at ${size.width}x${size.height}`;
    await phone.page.setViewportSize(size);
    await phone.page.waitForTimeout(300);
    await phone.page.locator('#cmpOptionsBtn').click();
    await phone.page.locator('#cmpOptions [data-action="cmp-panel"][data-panel="review"]').click();
    await phone.page.waitForFunction(() => document.querySelector('#cmpPanel.is-sheet:not([hidden])'));
    await phone.page.locator('#cmpPanel [data-action="cmp-close-panel"]').focus();
    const names = [];
    let previous = null;
    for (let i = 0; i < 60; i += 1) {
      await phone.page.keyboard.press('Tab');
      const at = await phone.page.evaluate(() => {
        const el = document.activeElement;
        return {
          inside: document.getElementById('cmpPanel').contains(el),
          key: el.dataset.action ? `${el.dataset.action}|${el.dataset.crit || ''}|${el.dataset.col || ''}|${el.dataset.value || ''}` : `${el.localName}|${el.id}|${el.name || ''}|${el.dataset.note || ''}|${el.parentElement?.dataset.crit || ''}`,
          name: (el.getAttribute('aria-label') || el.textContent || el.id).replace(/\s+/g, ' ').trim(),
        };
      });
      assert.ok(at.inside, `${label}: Tab ${i + 1} left the sheet`);
      assert.notEqual(at.key, previous, `${label}: Tab ${i + 1} stayed on "${at.name}"`);
      previous = at.key;
      names.push(at.key);
    }
    assert.ok(names.some((k) => k.startsWith('cmp-copy-review')), `${label}: Tab never reached Copy review as Markdown`);
    assert.ok(names.some((k) => k.includes('cmpReviewSummary')), `${label}: Tab never reached the summary`);
    assert.ok(names.some((k) => k.startsWith('cmp-close-panel')), `${label}: Tab never came back round to Close review`);
    // A closed criterion's summary is a stop; Enter opens it and Tab goes on
    // into its marks.
    const closed = await phone.page.evaluate(() => document.querySelector('#cmpPanel details.crit:not([open])')?.dataset.crit || null);
    assert.ok(closed, `${label}: every criterion is open, so there is nothing to expand`);
    assert.ok(names.some((k) => k.startsWith('summary||') && k.endsWith(`|${closed}`)), `${label}: Tab never reached the summary of the closed criterion "${closed}"`);
    await phone.page.locator(`#cmpPanel details.crit[data-crit="${closed}"] > summary`).focus();
    await phone.page.keyboard.press('Enter');
    await phone.page.keyboard.press('Tab');
    assert.ok(await phone.page.evaluate((crit) => Boolean(document.activeElement?.closest(`.crit[data-crit="${CSS.escape(crit)}"] .marks`)), closed), `${label}: Tab after opening "${closed}" did not enter its marks`);
    await phone.page.keyboard.press('Escape');
    await focusOn(phone.page, '#cmpOptionsBtn', `${label}: closing the sheet lost focus`);
  }
  await phone.context.close();

  // ── A write that fails: a rename, and an undo of a delete ─────────────────
  await checkFailedWrites();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: a Review panel over the columns taking focus from its toggle, Shift+Tab out of it closing it with focus kept, in sight, in column C, and a click in column A leaving it open; every stop from Close review to Copy review and back clear of the sticky head and foot at 1440 and 1024, with the foot measured into the scroll padding; Remove criterion leaving Add criterion in sight; an undo toast held past ten seconds while Undo has focus or the pointer is on it, running out once the pointer leaves, Undo reached and used from the keyboard, Escape on it putting focus on a control on screen; the status toast lifted clear of the undo toast at 1440 and 390, and clear of a copied column\'s Save and Cancel; the phone Review sheet at 390x844 and 640x720 where Tab never stalls, reaches Copy review, the summary and a closed criterion, which Enter opens and Tab enters; and a rename or an undo whose write fails saying so, the undone set open as not saved, and an undo that throws reported.');
} finally {
  await browser.close();
}

/**
 * IndexedDB writes made to fail (the put's transaction aborts, as a full
 * quota does), switched on and off by a flag.
 */
async function checkFailedWrites() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function failingPut(...args) {
      const request = put.apply(this, args);
      if (window.failWrites) this.transaction.abort();
      return request;
    };
  });
  const page = await context.newPage();
  const logged = [];
  page.on('pageerror', (error) => errors.push(`failed writes: ${error.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') logged.push(msg.text()); });
  await page.goto(`${base}/?check=failed-writes-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-dossier-booting'));
  await page.locator('#viewCompare').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'compare');
  const opened = await page.evaluate(async () => {
    const { api } = await import('/js/compare/index.js');
    const bundle = (title) => ({
      dossierCompare: {
        version: 1,
        title,
        columns: [
          { id: 'k1', role: 'human', label: 'Draft', source: { kind: 'markdown', name: 'a.md', text: '# A\n\n## Summary\n\nOne.' } },
          { id: 'k2', role: 'agent', label: 'Agent', source: { kind: 'text', name: 'b.txt', text: 'Two.' } },
        ],
      },
    });
    const { fromBundle } = await import('/js/compare/records.js');
    await api.openBundleSet(fromBundle(bundle('Beta report')));
    const beta = api.compare.set.id;
    await api.openBundleSet(fromBundle(bundle('Alpha report')));
    return { alpha: api.compare.set.id, beta };
  });
  await page.waitForFunction((id) => location.hash.endsWith(id), opened.alpha);
  await page.locator('#cmpSwitcherBtn').click();
  await page.waitForFunction(() => document.activeElement?.id === 'cmpSwitcherFilter');

  // A rename of a set that is not open, with the write failing.
  await page.evaluate(() => { window.failWrites = true; });
  const beta = page.locator(`#cmpSwitcher .sw__row[data-set-id="${opened.beta}"]`);
  await beta.locator('[data-action="cmp-rename-row"]').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Beta renamed');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('app-toast')?.textContent.includes('could not be saved'), null, { timeout: 3000 })
    .catch(() => assert.fail('A rename whose write failed said nothing'));
  assert.equal(await beta.locator('.sw__title').innerText(), 'Beta report', 'The row shows a title that was not saved');
  await page.evaluate(() => { window.failWrites = false; });

  // Delete the open set, then undo it while the write fails.
  await page.locator(`#cmpSwitcher .sw__row[data-set-id="${opened.alpha}"] [data-action="cmp-delete-set"]`).click();
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).waitFor();
  await page.evaluate(() => { window.failWrites = true; });
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => document.getElementById('app-toast')?.textContent.includes('stays only until the tab closes'), null, { timeout: 3000 })
    .catch(() => assert.fail('An undo whose write failed said nothing'));
  assert.equal(await page.locator('.cmp-toolbar .set-title__text').innerText(), 'Alpha report', 'The undone set is not open');
  assert.equal(await page.evaluate(() => location.hash), '#/~compare', 'The address names a set that is not saved');
  await page.locator('#cmpSwitcher .sw__meta', { hasText: 'not saved' }).waitFor({ timeout: 3000 })
    .catch(() => assert.fail('The switcher has no "not saved" row for the undone set'));
  await page.evaluate(() => { window.failWrites = false; });

  // An undo that throws is said, and logged.
  await page.keyboard.press('Escape');
  await page.evaluate(async () => (await import('/js/compare/popover.js')).undoToast(document.getElementById('cmpToast'), 'A throw check.', () => { throw new Error('a broken undo'); }));
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('#cmpToast', { hasText: 'That could not be undone.' }).waitFor();
  assert.ok(logged.some((text) => text.includes('The undo did not finish')), 'An undo that threw was not logged');
  assert.deepEqual(logged.filter((text) => !text.includes('The undo did not finish')), [], 'The page logged errors');
  await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('dossier-compare');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  }));
  await context.close();
}
