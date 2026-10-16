/**
 * Browser checks for the Compare view's analysis: difference marks on the
 * bundled example, Word marks and Show removed words, the base picker,
 * previous and next change with the counter and the ruler, the Sections and
 * Review panels (overlay, dock, pin, phone sheet), Blind, the review kept
 * across a reload, and every way a comparison leaves: the one-file export
 * opened with the network cut (it still syncs and steps), the bundle round
 * trip and the `#dc=` link. Also what the verifier found: the counter on
 * the first change when the example opens, stats deltas left of the base
 * after a reload, the tag on a table row, one Original notice, marks that
 * keep on Space, Blind in the switcher and the column menu, the export's
 * notices, and a link too long to offer. And what the second verifier
 * found: `]` reaching the last change of a column (in the app and in the
 * file), a Sections row putting the matched heading on the reading line of
 * every column, the check of a chosen mark at 360 px, the panel starting at
 * its top when it switches, a criterion menu instead of a row of buttons,
 * the change breakdown in the head, and Blind keeping roles, ids, file
 * names and moves out of the markup and the column forms.
 *
 * Run against the dev server: `node scripts/check-compare-analysis.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const verify = path.join(root, '.verify');
await fs.mkdir(verify, { recursive: true });
const browser = await chromium.launch();
const errors = [];

function watch(page, label = '') {
  page.on('pageerror', (error) => errors.push(`${label}${page.url()}: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label}${page.url()}: console: ${msg.text()}`);
  });
}

async function noOverflow(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(over <= 1, `${label}: the page scrolls sideways by ${over}px`);
}

async function focusOn(page, selector, why) {
  try {
    await page.waitForFunction((sel) => Boolean(document.activeElement?.matches?.(sel)), selector, { timeout: 2000 });
  } catch {
    const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120) || 'nothing');
    assert.fail(`${why}: focus is on ${at}, not ${selector}`);
  }
}

/** Where an element sits in its column's scroller, in px from the scroller's top edge. */
function topInScroller(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const scroller = el?.closest('.col__scroll');
    return el && scroller ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;
  }, selector);
}

/** A heading's text as written, without the difference marks inside it. */
const plainHeadingTop = (page, colId, wanted) => page.evaluate(([id, text]) => {
  const plain = (h) => {
    const c = h.cloneNode(true);
    c.querySelectorAll('.visually-hidden, del, .u-label, .cur-tag').forEach((e) => e.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  };
  const scroller = document.querySelector(`#cmp-col-${id} .col__scroll`);
  const h = [...scroller.querySelectorAll('.r-h')].find((el) => plain(el) === text);
  return h ? h.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;
}, [colId, wanted]);

async function openExample(page) {
  await page.locator('#openReport').click();
  await page.locator('#openExamples [data-action="cmp-example"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 3);
  await page.locator('#cmp-col-k3 .ruler').waitFor();
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${base}/?check=analysis`, { waitUntil: 'networkidle' });
  await openExample(page);

  // The example is drawn before the view shows: the counter is still placed
  // on the change at the top of C (its title), and `]` goes on from there.
  await page.waitForFunction(() => /^1 of \d+$/.test(document.querySelector('.counter__main')?.textContent || ''));
  assert.equal(await page.locator('#cmp-col-k3 .u-current').getAttribute('data-chg'), '1', 'Change 1 is outlined on open');

  // ── Marks: C against B, the base; A too different for word marks ────────
  assert.equal(await page.locator('#cmp-col-k2 .tag--base').count(), 1, 'B is the base: what C fixes');
  assert.match(await page.locator('#cmp-col-k2 .col__diff').innerText(), /Base for differences/);
  assert.match(await page.locator('#cmp-col-k3 .col__diff').innerText(), /\d+ differences from B/);
  assert.match(await page.locator('#cmp-col-k3 .col__diff .key').innerText(), /^\W*\d+ changed\W+\d+ added\W+\d+ removed$/, 'The head says what the differences are');
  assert.match(await page.locator('#cmp-col-k3 .col__stats').innerText(), /\((\+|−)\d+\)/, 'Stats show deltas against the base');
  const marks = await page.evaluate(() => {
    const c = document.querySelector('#cmp-col-k3 .col__scroll');
    return {
      ins: c.querySelectorAll('.unit ins').length,
      del: c.querySelectorAll('.unit del').length,
      insHidden: c.querySelector('.unit ins > .visually-hidden')?.textContent,
      changedHidden: c.querySelector('.u-changed:not(.u-current) .u-sr')?.textContent,
      currentHidden: c.querySelector('.u-current .u-sr')?.textContent,
      added: c.querySelector('.u-added .u-label')?.textContent,
      ghost: c.querySelector('.ghost .ghost__what')?.textContent,
      changes: c.querySelectorAll('[data-chg]').length,
      ticks: document.querySelectorAll('#cmp-col-k3 .ruler .t').length,
      baseRuler: document.querySelectorAll('#cmp-col-k2 .ruler').length,
    };
  });
  assert.ok(marks.ins > 3 && marks.del > 3, 'C shows inserted and removed words');
  assert.equal(marks.insHidden, 'inserted: ');
  assert.match(marks.changedHidden, /^Changed (paragraph|heading|list item): $/);
  assert.match(marks.currentHidden, /^Changed heading, change 1 of \d+: $/, 'The current change says which it is');
  assert.equal(marks.added, 'Added');
  assert.match(marks.ghost, /^Removed from B: .+, \d+ words?$/);
  assert.equal(marks.ticks, marks.changes, 'One ruler tick per change');
  assert.equal(marks.baseRuler, 0, 'The base column has no ruler');
  // The fix corrects the wrong figure word by word.
  assert.match(await page.locator('#cmp-col-k3 .col__scroll').innerText(), /3\.4[\s\S]*2\.9/);
  assert.match(await page.locator('#cmp-col-k1 .col-note').first().innerText(), /Too different from B to mark word by word/);
  assert.equal(await page.locator('#cmp-col-k1 .unit ins').count(), 0, 'A too different column has margin bars only');
  assert.ok(await page.locator('#cmp-col-k1 .u-bar-chg, #cmp-col-k1 .u-bar-add').count() > 0);

  // Word marks on A, and off again.
  const words = page.locator('#cmp-col-k1 [data-action="cmp-word-marks"]');
  assert.equal(await words.getAttribute('aria-pressed'), 'false');
  await words.click();
  await page.waitForFunction(() => document.querySelectorAll('#cmp-col-k1 .unit ins').length > 0);
  assert.equal(await page.locator('#cmp-col-k1 [data-action="cmp-word-marks"]').getAttribute('aria-pressed'), 'true');
  // A table row as the current change carries its "n of N" tag too.
  const rowChange = await page.locator('#cmp-col-k1 tr[data-chg]:not(.ghost-row)').first().getAttribute('data-chg');
  assert.ok(rowChange, 'A has a marked table row against B');
  await page.locator(`#cmp-col-k1 .ruler .t[data-chg="${rowChange}"]`).click({ force: true });
  await page.waitForTimeout(300);
  const rowTag = await page.evaluate(() => {
    const tag = document.querySelector('#cmp-col-k1 tr.u-current > :last-child > .cur-tag');
    const box = tag?.getBoundingClientRect();
    const scroller = document.querySelector('#cmp-col-k1 .col__scroll').getBoundingClientRect();
    return tag ? { text: tag.textContent, shown: box.width > 0 && box.top >= scroller.top && box.bottom <= scroller.bottom } : null;
  });
  assert.ok(rowTag?.shown, 'The tag of a current table row is in its last cell, on screen');
  assert.match(rowTag.text, new RegExp(`^${rowChange} of \\d+$`));
  await page.locator('#cmp-col-k1 [data-action="cmp-word-marks"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#cmp-col-k1 .unit ins').length === 0);

  // A column in its original layout says once, in its head, why it is not marked.
  await page.locator('#cmp-col-k1 [data-action="cmp-column-menu"]').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-col-mode"][data-value="original"]').click();
  await page.locator('#cmp-col-k1 iframe.col__frame').waitFor();
  assert.equal(await page.locator('#cmp-col-k1').getByText('Differences show in Dossier format.').count(), 1, 'One notice, not two');
  assert.match(await page.locator('#cmp-col-k1 .col__diff').innerText(), /Differences show in Dossier format\./);
  await page.locator('#cmp-col-k1 [data-action="cmp-column-menu"]').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-col-mode"][data-value="format"]').click();
  await page.locator('#cmp-col-k1 .ruler').waitFor();

  // The against menu: Show removed words, then a different base.
  await page.locator('#cmpAgainst').click();
  assert.equal(await page.locator('#cmpDiffMenu').isVisible(), true);
  await focusOn(page, '#cmpDiffMenu [aria-checked="true"]', 'The menu opens on the base');
  await page.locator('#cmpDiffMenu [data-opt="showRemoved"]').click();
  assert.match(await page.locator('#compareView').getAttribute('class'), /hide-removed/);
  assert.equal(await page.locator('#cmp-col-k3 .unit del').first().evaluate((el) => getComputedStyle(el).display), 'none');
  await page.locator('#cmpDiffMenu [data-opt="showRemoved"]').click();
  await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k3"]').click();
  await page.waitForFunction(() => document.querySelector('#cmp-col-k3 .tag--base') && document.querySelectorAll('#cmp-col-k2 .unit ins').length > 0);
  assert.match(await page.locator('#cmpAgainst').getAttribute('aria-label'), /against C, Fixes/);
  await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k2"]').click();
  await page.waitForFunction(() => document.querySelector('#cmp-col-k2 .tag--base'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpDiffMenu').isVisible(), false);
  await focusOn(page, '#cmpAgainst', 'Escape returns focus to the picker');

  // ── Previous and next change, the counter, the ruler ─────────────────────
  // From the top of C: changing the base twice redrew the columns, which
  // keep the reader's place, wherever that was.
  await page.locator('#cmp-col-k3 .col__scroll').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.locator('#cmp-col-k3 .col__scroll').focus();
  const total = marks.changes;
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await page.waitForTimeout(900);
  const main = await page.locator('.counter__main').innerText();
  const n = Number(/^(\d+) of (\d+)$/.exec(main)?.[1]);
  assert.match(main, new RegExp(`^\\d+ of ${total}$`));
  assert.equal(await page.locator('.counter__sub').innerText(), 'in C');
  assert.ok(n >= 2, `] moved to change ${n}`);
  assert.equal(await page.locator('#cmp-col-k3 .u-current').getAttribute('data-chg'), String(n));
  assert.equal(await page.locator('#cmp-col-k3 .u-current .cur-tag').innerText(), `${n} of ${total}`);
  const curTop = await topInScroller(page, '#cmp-col-k3 .u-current');
  assert.ok(curTop > 0 && curTop < 140, `The current change is at ${curTop}px, not near the top of C`);
  assert.match(await page.locator('#cmpLive').innerText(), new RegExp(`^Change ${n} of ${total} in C, (changed|added|removed)$`));
  assert.match(await page.locator('#cmp-col-k3 .u-current .u-sr, #cmp-col-k3 .u-current').first().innerText(), /./);
  await page.keyboard.press('[');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.counter__main').innerText(), `${n - 1} of ${total}`);
  // The ruler: a click on the last tick brings the last change in.
  await page.locator('#cmp-col-k3 .ruler .t').last().click({ force: true });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.counter__main').innerText(), `${total} of ${total}`);
  assert.equal(await page.locator('#cmp-col-k3 .ruler .t.is-current').getAttribute('data-chg'), String(total));
  assert.ok(await page.locator('#cmp-col-k2 .col__scroll').evaluate((el) => el.scrollTop) > 50, 'Sync brought the base along');
  // The current change paints over the next unit's tint: its outline is whole.
  assert.equal(await page.locator('#cmp-col-k3 .u-current').evaluate((el) => getComputedStyle(el).zIndex), '1');
  await page.screenshot({ path: path.join(verify, 'compare-analysis-1440.png') });

  // `]` from the top reaches the last change and then says so. At its end a
  // column cannot scroll, and `]` used to stop short of its last changes.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#cmp-col-k3 .col__scroll').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  await page.locator('#cmp-col-k3 .col__scroll').focus();
  for (let i = 0; i < total + 2; i += 1) {
    await page.keyboard.press(']');
    await page.waitForTimeout(200);
  }
  assert.equal(await page.locator('.counter__main').innerText(), `${total} of ${total}`, '] reaches the last change of C');
  assert.equal(await page.locator('#cmp-col-k3 .u-current').getAttribute('data-chg'), String(total));
  assert.equal(await page.locator('#app-toast').innerText(), 'That was the last change in C.');
  await page.keyboard.press('[');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.counter__main').innerText(), `${total - 1} of ${total}`, '[ steps back from the end');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // At the pace a reader steps, with smooth scrolling, from four before the end.
  await page.locator(`#cmp-col-k3 .ruler .t[data-chg="${total - 4}"]`).click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('#cmp-col-k3 .col__scroll').focus();
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press(']');
    await page.waitForTimeout(800);
  }
  assert.equal(await page.locator('.counter__main').innerText(), `${total} of ${total}`, '] at a normal pace reaches the last change');

  // ── Sections: lies over the columns at 1440, rows bring sections in ──────
  const sectionsToggle = page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]');
  await sectionsToggle.click();
  await page.locator('#cmpPanel .secmap').waitFor();
  assert.match(await page.locator('#compareView').getAttribute('class'), /panel-open.*panel-overlay|panel-overlay.*panel-open/);
  const contributing = page.locator('#cmpPanel .secmap tr', { hasText: 'Contributing factors' });
  assert.match(await contributing.locator('td[data-col="k1"]').innerText(), /Missing/);
  assert.match(await contributing.locator('td[data-col="k3"]').innerText(), /Missing/);
  assert.equal(await contributing.locator('.miss').first().evaluate((el) => getComputedStyle(el).color === getComputedStyle(document.querySelector('.col__who')).color), true, 'Missing is secondary ink, not red');
  assert.match(await page.locator('#cmpPanel .coverage').innerText(), /covers \d+ of \d+ base sections[\s\S]*Matched by heading text, not by meaning\./);
  assert.match(await page.locator('#cmpPanel .secmap').innerText(), /Only in other columns[\s\S]*What went well/);
  assert.match(await page.locator('#cmpPanel .panel__intro').first().innerText(), /bring that section to the reading line in every column\.$/);
  await page.locator('#cmpPanel .secmap button', { hasText: /^Impact/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'A row chosen in a panel over the columns closes it');
  // Each column's own heading for the row is on its reading line, 30 % down,
  // A's "Customer impact" (renamed) included.
  for (const [colId, text] of [['k1', 'Customer impact'], ['k2', 'Impact'], ['k3', 'Impact']]) {
    const top = await plainHeadingTop(page, colId, text);
    const line = await page.locator(`#cmp-col-${colId} .col__scroll`).evaluate((el) => el.clientHeight * 0.3);
    assert.ok(top !== null && Math.abs(top - line) < 6, `${colId}'s "${text}" is at ${top}px, not on the reading line at ${Math.round(line)}px`);
  }
  assert.match(await page.locator('#cmpLive').innerText(), /^Impact, at the reading line, in every column\.$/);
  await focusOn(page, '.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]', 'Closing the panel returns focus to its toggle');
  await sectionsToggle.click();
  await page.locator('#cmpPanel .secmap').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'Escape closes a panel over the columns');
  await focusOn(page, '.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]', 'Escape returns focus to the toggle');
  // Switching panels starts the new one at its top.
  await sectionsToggle.click();
  await page.locator('#cmpPanel .secmap').waitFor();
  await page.locator('#cmpPanel').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  assert.ok(await page.locator('#cmpPanel').evaluate((el) => el.scrollTop) > 0, 'The Sections panel scrolls');

  // ── Review: marks, preferred, notes; counted, never scored ───────────────
  await page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="review"]').click();
  await page.locator('#cmpPanel .crit').first().waitFor();
  assert.equal(await page.locator('#cmpPanel').evaluate((el) => el.scrollTop), 0, 'Review opens at its top, not where Sections was scrolled');
  const mark = (col, value, crit = 'accuracy') => page.locator(`#cmpPanel [data-action="cmp-mark"][data-crit="${crit}"][data-col="${col}"][data-value="${value}"]`);
  await mark('k1', 'strong').click();
  await mark('k2', 'weak').click();
  await mark('k3', 'strong').click();
  // Arrow keys move a mark within its group.
  await mark('k3', 'strong').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#cmpPanel [data-crit="accuracy"][data-col="k3"][data-value="adequate"]')?.getAttribute('aria-checked') === 'true');
  const tick = await page.locator('#cmpPanel [data-crit="accuracy"][data-col="k3"][data-value="adequate"] .ck').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(tick >= 10, `A chosen Adequate keeps its check at 360 px (${tick}px wide)`);
  await page.keyboard.press('ArrowLeft');
  // Space on the chosen mark confirms it, as on any radio; it used to clear it.
  await page.waitForFunction(() => document.querySelector('#cmpPanel [data-crit="accuracy"][data-col="k3"][data-value="strong"]')?.getAttribute('aria-checked') === 'true');
  await focusOn(page, '#cmpPanel [data-crit="accuracy"][data-col="k3"][data-value="strong"]', 'Arrows keep focus on the mark');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  assert.equal(await mark('k3', 'strong').getAttribute('aria-checked'), 'true', 'Space and Enter keep the chosen mark');
  assert.equal(await mark('k3', 'strong').getAttribute('tabindex'), '0');
  // Marks are cleared with Clear marks, in the criterion's menu, which has an undo.
  assert.equal(await page.locator('#cmpPanel .crit__tools').count(), 0, 'No row of buttons under every criterion');
  const critMore = page.locator('#cmpPanel .crit__more[data-crit="accuracy"]');
  await critMore.click();
  await page.locator('#cmpPanel .crit__menu:not([hidden])').waitFor();
  assert.equal(await critMore.getAttribute('aria-expanded'), 'true');
  await focusOn(page, '#cmpPanel .crit__menu [role="menuitem"][data-action="cmp-crit-rename"]', 'The criterion menu opens on its first item');
  assert.equal(await page.locator('#cmpPanel .crit__menu [data-action="cmp-crit-move"][data-dir="-1"]').isDisabled(), true, 'The first criterion cannot move up');
  await page.keyboard.press('ArrowDown');
  await focusOn(page, '#cmpPanel .crit__menu [data-action="cmp-crit-clear"]', 'Arrows move through the menu');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#cmpPanel .crit[data-crit="accuracy"] [aria-checked="true"]'));
  assert.equal(await page.locator('#cmpPanel .crit__menu:not([hidden])').count(), 0, 'Choosing an item closes the menu');
  await critMore.click();
  assert.equal(await page.locator('#cmpPanel .crit__menu [data-action="cmp-crit-clear"]').isDisabled(), true, 'Nothing left to clear');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpPanel .crit__menu:not([hidden])').count(), 0, 'Escape closes the criterion menu');
  assert.equal(await page.locator('#cmpPanel').isVisible(), true, 'and only the menu');
  await focusOn(page, '#cmpPanel .crit__more[data-crit="accuracy"]', 'Escape returns focus to the menu button');
  await page.locator('#cmpToast button', { hasText: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#cmpPanel .crit[data-crit="accuracy"] [aria-checked="true"]').length === 3);
  await page.locator('#cmpPanel input[name="cmp-pref"][value="k3"]').check();
  await page.locator('#cmpPanel textarea[data-note="k2"]').fill('Wrong trigger and an inflated latency figure.');
  await page.locator('#cmpPanel textarea[data-summary]').fill('Ship C.');
  await page.locator('#cmpPanel textarea[data-summary]').blur();
  assert.match(await page.locator('#cmpPanel .tally').innerText(), /1 strong[\s\S]*1 weak[\s\S]*1 strong/);
  assert.ok(!/score|total|rank/i.test(await page.locator('#cmpPanel .tally').innerText()), 'The tally only counts');
  assert.equal(await page.locator('#cmpPanel .rec').innerText(), 'Recorded with labels visible.');
  await page.locator('#cmpPanel [data-action="cmp-copy-review"]').click();
  await page.waitForTimeout(200);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^# Review: Illustrative example/);
  assert.match(copied, /\| Accuracy \| Strong \| Weak \| Strong \|/);
  assert.match(copied, /Wrong trigger/);
  // Changed, the example became a saved comparison; a reload keeps the review.
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#cmp-col-k3 .ruler').waitFor();
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'A stored panel that would lie over the columns stays closed on load');
  // A is drawn before B, the base, and still shows its counts against it.
  assert.match(await page.locator('#cmp-col-k1 .col__stats').innerText(), /words \((\+|−)\d+\)/, 'A shows deltas against B after a reload');
  await page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="review"]').click();
  await page.locator('#cmpPanel .crit').first().waitFor();
  assert.equal(await mark('k2', 'weak').getAttribute('aria-checked'), 'true', 'Marks survive a reload');
  assert.equal(await mark('k3', 'strong').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#cmpPanel input[name="cmp-pref"][value="k3"]').isChecked(), true);
  assert.equal(await page.locator('#cmpPanel textarea[data-note="k2"]').inputValue(), 'Wrong trigger and an inflated latency figure.');
  assert.equal(await page.locator('#cmpPanel textarea[data-summary]').inputValue(), 'Ship C.');

  // Docked by the width rule at 1680, and by the pin at 1440.
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.waitForTimeout(300);
  assert.match(await page.locator('#compareView').getAttribute('class'), /panel-docked/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  assert.match(await page.locator('#compareView').getAttribute('class'), /panel-overlay/);
  await page.locator('#cmpPanel [data-action="cmp-pin"]').click();
  assert.match(await page.locator('#compareView').getAttribute('class'), /panel-docked/);
  assert.equal(await page.locator('#cmpPanel [data-action="cmp-pin"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#cmpPanel [data-action="cmp-pin"]').click();
  await noOverflow(page, 'Review at 1440');

  // ── Blind: report numbers, neutral roles, names hidden until Reveal ──────
  await page.locator('.cmp-toolbar [data-action="cmp-toggle-blind"]').click();
  await page.waitForFunction(() => document.querySelector('#compareView').classList.contains('blind'));
  const blind = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent).join(' | ');
    return {
      labels: [...document.querySelectorAll('#compareView .col__label')].map((el) => el.textContent),
      visible: [q('#compareView .col__head'), q('.focus-switch'), q('#cmpAgainst'), q('#cmpPanel'), q('.cmp-toolbar .set-title'),
        document.querySelector('#cmpAgainst').getAttribute('aria-label'), document.title].join(' || '),
      order: [...document.querySelectorAll('#compareView .col')].map((el) => [el.style.order, el.querySelector('.col__label').textContent]),
      stripe: getComputedStyle(document.querySelector('#cmp-col-k1 .col__head')).borderTopColor,
      neutral: getComputedStyle(document.querySelector('#cmp-col-k3 .col__head')).borderTopColor,
    };
  });
  assert.deepEqual([...blind.labels].sort(), ['Report 1', 'Report 2', 'Report 3']);
  for (const word of ['Human', 'Agent', 'Fixes', 'Whitfield', 'agent run', 'Illustrative example']) {
    assert.ok(!blind.visible.includes(word), `Blind still shows "${word}"`);
  }
  const heads = await page.locator('#compareView .col__head').allTextContents();
  assert.ok(!/Markdown|HTML|Dossier/.test(heads.join(' ')), 'Blind still shows what kind each report is');
  for (const [order, label] of blind.order) assert.equal(label, `Report ${order}`, 'Columns are laid out in report order');
  assert.equal(blind.stripe, blind.neutral, 'Role colours turn neutral');
  assert.match(await page.locator('#cmpPanel .blind-hint').innerText(), /^Blind is on/);
  // The switcher and the column menu keep the secret too.
  await page.locator('#cmpSwitcherBtn').click();
  await page.locator('#cmpSwitcher .sw__row.is-current').waitFor();
  const current = await page.locator('#cmpSwitcher .sw__row.is-current').innerText();
  assert.match(current, /^Blind review/);
  for (const word of ['Human', 'Agent', 'Fixes', 'Illustrative example']) assert.ok(!current.includes(word), `The switcher still shows "${word}"`);
  assert.equal(await page.locator('#cmpSwitcher .sw__row.is-current [data-action="cmp-rename-row"]').count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('#cmp-col-k2 [data-action="cmp-column-menu"]').click();
  assert.match(await page.locator('#cmpColumnMenu').getAttribute('aria-label'), /^Report \d options$/);
  assert.equal(await page.locator('#cmpColumnMenu [data-action="cmp-details"]').isDisabled(), true, 'Label, role and author waits for Blind to be off');
  assert.deepEqual(await page.locator('#cmpColumnMenu [data-action="cmp-move"]').evaluateAll((list) => list.map((b) => b.disabled)), [true, true], 'Moves wait for Blind to be off');
  await page.keyboard.press('Escape');
  // The markup keeps the secret: no real role on anything but the Add menu's choices.
  const roles = await page.evaluate(() => [...document.querySelectorAll('#compareView [data-role]')]
    .filter((el) => !el.closest('#cmpAddMenu')).map((el) => el.dataset.role));
  assert.ok(roles.length > 5 && roles.every((r) => r === 'other'), `Blind leaves roles in the markup: ${[...new Set(roles)].join(', ')}`);
  // Edit source names the report, not the column letter or the file. Report
  // 1 is the leftmost column, clear of the Review panel.
  const first = await page.evaluate(() => [...document.querySelectorAll('#compareView .col')].find((el) => el.style.order === '1').dataset.col);
  await page.locator(`#cmp-col-${first} [data-action="cmp-column-menu"]`).click();
  await page.locator('#cmpColumnMenu [data-action="cmp-edit-source"]').click();
  const sourceLabel = await page.locator(`#cmp-col-${first} .col-form__label`).innerText();
  assert.equal(sourceLabel, 'Source of Report 1', 'Edit source under Blind names the report only');
  await page.locator(`#cmp-col-${first} [data-action="cmp-cancel-form"]`).click();
  await page.locator(`#cmp-col-${first} .reader`).waitFor();
  // A file made under Blind keeps it in its markup too.
  await page.locator('#shareReport').click();
  const [blindDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-html"]').click()]);
  assert.equal(blindDownload.suggestedFilename(), 'blind-review.html');
  const blindFile = path.join(verify, 'compare-export-blind.html');
  await blindDownload.saveAs(blindFile);
  // The markup, not the inlined stylesheets, whose rules name every role.
  const blindHtml = (await fs.readFile(blindFile, 'utf8')).replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.ok(!/data-role="(human|agent|fix)"/.test(blindHtml), 'The blind file names the roles in its markup');
  assert.ok(!/(data-col|id|for|href|aria-[a-z]+)="#?(cmp-(col-)?)?k\d/.test(blindHtml), 'The blind file keeps the column ids, which follow the order they were added in');
  assert.match(blindHtml, /data-col="r1"[\s\S]*data-col="r2"[\s\S]*data-col="r3"/, 'The blind file lays the reports out in report order');
  // The reports' own text may say anything; what Dossier writes around them may not.
  for (const word of ['Human draft', 'human-draft', 'Agent output', 'Illustrative example: checkout latency incident']) {
    assert.ok(!blindHtml.includes(word), `The blind file says "${word}"`);
  }
  await mark('k1', 'weak', 'completeness').click();
  assert.match(await page.locator('#cmpPanel .rec').innerText(), /^Recorded while blind/);
  await page.locator('.cmp-toolbar [data-action="cmp-toggle-blind"]').click();
  await page.waitForFunction(() => !document.querySelector('#compareView').classList.contains('blind'));
  assert.match(await page.locator('#cmp-col-k1 .col__label').evaluate((el) => el.textContent), /^Column A, Human draft$/, 'Reveal brings the names back');
  assert.match(await page.locator('#cmpPanel .rec').innerText(), /^Recorded while blind/, 'Reveal keeps the blind note');
  assert.equal(await page.locator('#cmp-col-k1').evaluate((el) => el.style.order), '');

  // ── Share and export in Compare ──────────────────────────────────────────
  // The file starts on the column whose changes the counter shows: C, read last.
  await page.locator('#cmp-col-k3 .col__scroll').focus();
  await page.waitForFunction(() => document.querySelector('.counter__sub')?.textContent === 'in C');
  await page.locator('#shareReport').click();
  const choices = await page.locator('#exportBody .ds-export__choice').evaluateAll((list) => list.map((b) => [b.dataset.action, b.disabled]));
  assert.deepEqual(choices, [['cmp-share-link', false], ['cmp-export-html', false], ['cmp-export-bundle', false], ['cmp-export-review', false]]);
  await page.locator('[data-action="cmp-share-link"]').click();
  await page.waitForTimeout(300);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#dc=[A-Za-z0-9_-]+$/);

  await page.locator('#shareReport').click();
  const [htmlDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-html"]').click()]);
  const exported = path.join(verify, 'compare-export.html');
  await htmlDownload.saveAs(exported);
  const file = await fs.readFile(exported, 'utf8');
  assert.match(file, /Too different from B to mark word by word/);
  assert.ok(!file.includes('Turn on Word marks'), 'The file points at a Word marks button it does not have');
  await page.locator('#shareReport').click();
  const [bundleDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-bundle"]').click()]);
  assert.match(bundleDownload.suggestedFilename(), /\.dossier-compare\.json$/);
  const bundleFile = path.join(verify, 'compare.dossier-compare.json');
  await bundleDownload.saveAs(bundleFile);
  const before = await page.evaluate(async () => {
    const { compare } = await import('/js/compare/index.js');
    const { toBundle } = await import('/js/compare/records.js');
    return toBundle(compare.set);
  });

  // The file opens with the network cut, still syncs and still steps.
  const offline = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true });
  const op = await offline.newPage();
  watch(op, 'export: ');
  const requests = [];
  op.on('request', (req) => { if (!req.url().startsWith('file:') && !req.url().startsWith('data:') && req.url() !== 'about:srcdoc') requests.push(req.url()); });
  await op.goto(pathToFileURL(exported).href);
  await op.waitForTimeout(500);
  assert.equal(await op.locator('#compareView .col').count(), 3);
  assert.ok(await op.locator('#compareView ins').count() > 3, 'The marks travel in the file');
  assert.match(await op.locator('#xCounter .counter__main').innerText(), /^\d+ of \d+$/, 'The file runs its script');
  assert.equal(await op.locator('iframe').count(), 0);
  await op.locator('#xNext').click();
  await op.waitForTimeout(200);
  await op.locator('#xNext').click();
  await op.waitForTimeout(300);
  assert.equal(await op.locator('.counter__sub').innerText(), 'in C');
  assert.ok(await op.locator('[data-col="k3"] .col__scroll').evaluate((el) => el.scrollTop) > 0, 'Next moved C');
  // ] reaches the last change in the file too, and says so past it.
  const fileTotal = await op.locator('[data-col="k3"] [data-chg]').count();
  await op.locator('[data-col="k3"] .col__scroll').focus();
  for (let i = 0; i < fileTotal + 1; i += 1) {
    await op.keyboard.press(']');
    await op.waitForTimeout(80);
  }
  assert.equal(await op.locator('#xCounter .counter__main').innerText(), `${fileTotal} of ${fileTotal}`, '] reaches the last change in the file');
  assert.equal(await op.locator('#xLive').innerText(), 'That was the last change in C.');
  await op.keyboard.press('[');
  await op.waitForTimeout(80);
  assert.equal(await op.locator('#xCounter .counter__main').innerText(), `${fileTotal - 1} of ${fileTotal}`);
  await op.locator('[data-col="k2"] .col__scroll').hover();
  await op.locator('[data-col="k2"] .col__scroll').evaluate((el) => { el.scrollTop = 600; });
  await op.waitForTimeout(300);
  const followed = await op.locator('[data-col="k3"] .col__scroll').evaluate((el) => el.scrollTop);
  assert.ok(followed > 200, `C did not follow B in the file (${followed})`);
  await op.locator('#xReview').click();
  assert.match(await op.locator('#xPanel').innerText(), /Recorded while blind[\s\S]*Wrong trigger/);
  assert.deepEqual(requests, [], 'The exported file asked the network for something');
  await offline.close();

  // The bundle and the link reopen the same comparison.
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(await fs.readFile(bundleFile, 'utf8'));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.waitForTimeout(800);
  const reopened = await page.evaluate(async () => {
    const { compare } = await import('/js/compare/index.js');
    const { toBundle } = await import('/js/compare/records.js');
    return { bundle: toBundle(compare.set), id: compare.set.id };
  });
  // The panel that was open is not part of what the comparison holds: at
  // this width it opens closed, by design.
  const same = (b) => ({ ...b.dossierCompare, created: 0, updated: 0, view: { ...b.dossierCompare.view, panel: null } });
  assert.deepEqual(same(reopened.bundle), same(before), 'A bundle round trip reopens identically');
  const lp = await context.newPage();
  watch(lp, 'link: ');
  await lp.goto(link);
  await lp.locator('#cmp-col-k3 .ruler').waitFor();
  assert.equal(await lp.locator('.cmp-toolbar .set-title__text').innerText(), 'Illustrative example: checkout latency incident');
  assert.match(await lp.evaluate(() => location.hash), /^#\/~compare\/c-/, 'The link becomes a saved comparison');
  await lp.close();

  // ── Phone: one column, panels as sheets under the header ─────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await noOverflow(page, 'Compare at 390');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'A phone never opens on a panel');
  await page.locator('#cmpOptionsBtn').click();
  await page.locator('#cmpOptions [data-action="cmp-panel"][data-panel="review"]').click();
  await page.waitForFunction(() => document.querySelector('#cmpPanel.is-sheet:not([hidden])'));
  assert.equal(await page.locator('#cmpScrim').isVisible(), true);
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#cmpPanel').contains(document.activeElement)), `Tab ${i + 1} left the Review sheet`);
  }
  await noOverflow(page, 'Review sheet at 390');
  await page.screenshot({ path: path.join(verify, 'compare-analysis-390.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false);
  await focusOn(page, '#cmpOptionsBtn', 'Closing the sheet returns focus to Options');

  // ── A comparison too long for a link says why, outside the dimmed choice ─
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const { api } = await import('/js/compare/index.js');
    const { addColumn } = await import('/js/compare/model.js');
    const bytes = crypto.getRandomValues(new Uint8Array(60000));
    const text = Array.from(bytes, (b) => String.fromCharCode(33 + (b % 90))).join('');
    api.commit(addColumn(api.compare.set, { role: 'other', source: { kind: 'text', name: 'noise.txt', text } }).set);
  });
  await page.locator('#shareReport').click();
  const linkChoice = page.locator('#exportBody [data-action="cmp-share-link"]');
  await linkChoice.waitFor();
  assert.equal(await linkChoice.isDisabled(), true);
  const why = page.locator('#exportBody .ds-export__why');
  assert.match(await why.innerText(), /^The link would be [\d,]+ characters, over the 32,000 a link can carry\./);
  assert.equal(await linkChoice.getAttribute('aria-describedby'), await why.getAttribute('id'));
  assert.equal(await why.evaluate((el) => getComputedStyle(el).opacity), '1', 'The reason is not dimmed with the button');
  await page.keyboard.press('Escape');

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: difference marks on the example (C against B with hidden words, labels, ghost rows and one ruler tick per change; A too different, with Word marks on and off), Show removed words, a new base and back, ] and [ with the counter, the tag and the announcement, a ruler tick, sync following, the Sections panel over the columns (Missing in secondary ink, coverage, a row bringing Impact in and closing it, Escape), the Review panel (marks by click and arrow key, preferred, notes, summary, counts only, copied as Markdown, kept across a reload, docked at 1680 and by the pin), Blind (numbers, report order, neutral stripes, no names anywhere, recorded while blind, Reveal), Share and export in Compare, the one-file export offline (marks, steps, sync, review, no request), the bundle round trip, the #dc= link, the Review sheet on a phone keeping Tab and returning focus, the counter on change 1 when the example opens, deltas left of the base after a reload, the tag of a table row, one Original notice, marks kept on Space with Clear marks and its undo, Blind in the switcher and the column menu, the notices in the file, and the reason a link is too long said outside the dimmed choice; ] to the last change of C (fast and at a normal pace) and in the file, with what it says past it, a Sections row on the reading line of every column, a whole current outline, the check of a chosen Adequate, a panel starting at its top, the criterion menu, the change breakdown in the head, and Blind keeping roles, ids, file names and moves out of the markup, the forms and a blind file.');
} finally {
  await browser.close();
}
