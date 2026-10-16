/**
 * Browser checks for the Compare view's analysis, part one: difference
 * marks on the bundled example (each column against its source when it
 * opens, then B as the base), a moved section, Word marks and Show removed
 * words, the base picker and its menu (rebuilt under Blind while closed), previous and next
 * change with the counter, the tag (kept inside the column while a change's
 * top is above it) and the ruler, `]` reaching the last change, the Sections
 * panel (a row on the reading line of every column), the Review panel
 * (marks by click and arrow key, a focus ring that is not the chosen ring,
 * every mark label in full at 360 px, the criterion menu, Clear marks and
 * the undo of Remove criterion keeping what was entered since), the review
 * kept across a reload, docking and the pin, and Blind (report numbers, no
 * names or roles anywhere, the column menu of Report 1 whatever the shuffle,
 * a blind one-file export). Part two, scripts/check-compare-export.mjs:
 * every way a comparison leaves, the phone, a panel crossing 700 px, and an
 * unreadable Dossier column.
 *
 * Run against the dev server: `node scripts/check-compare-analysis.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  base, verify, watch, noOverflow, focusOn, openExample, firstReport,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];

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

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=analysis`, { waitUntil: 'networkidle' });
  await openExample(page);

  // The example is drawn before the view shows: the counter is still placed
  // on the change at the top of C (its title), and `]` goes on from there.
  await page.waitForFunction(() => /^1 of \d+$/.test(document.querySelector('.counter__main')?.textContent || ''));
  assert.equal(await page.locator('#cmp-col-k3 .u-current').getAttribute('data-chg'), '1', 'Change 1 is outlined on open');

  // ── Each against its source, the default with a fix: A the base, B against
  // A, C against B, the column it fixes ─────────────────────────────────────
  assert.equal(await page.locator('#cmp-col-k1 .tag--base').count(), 1, 'A, the human draft, is the base');
  assert.match(await page.locator('#cmp-col-k1 .col__diff').innerText(), /fix is marked against the column it fixes/);
  assert.match(await page.locator('#cmp-col-k2 .col__diff').innerText(), /\d+ differences from A/);
  assert.match(await page.locator('#cmp-col-k3 .col__diff').innerText(), /\d+ differences from B/);
  assert.match(await page.locator('#cmpAgainst').getAttribute('aria-label'), /each column's source/);
  await page.locator('#cmpAgainst').click();
  await page.locator('#cmpDiffMenu [data-col="each"][aria-checked="true"]').waitFor();
  // B as the base for every column, for the checks below: A against B.
  await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k2"]').click();
  await page.waitForFunction(() => document.querySelector('#cmp-col-k2 .tag--base'));
  await page.keyboard.press('Escape');

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
  // A's "Root causes" sits where B has "Contributing factors": one move.
  assert.equal(await page.locator('#cmp-col-k1 [data-d="mov"]').count(), 1, 'A has one moved section against B');
  assert.equal(await page.locator('#cmp-col-k1 .u-label--moved').innerText(), 'Moved from after \u201cSummary\u201d in B');
  assert.equal(await page.locator('#cmp-col-k1 .ruler .t').count(), await page.locator('#cmp-col-k1 .col__scroll [data-chg]').count(), 'One ruler tick per change, the move included');
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
  await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="each"]').click();
  await page.waitForFunction(() => document.querySelector('#cmp-col-k1 .tag--base'));
  assert.equal(await page.locator('#cmpAgainst .picker__name').innerText(), 'its source');
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
  // A change whose top has gone up under the column's edge never shows a
  // cut tag, and the counter names the change that is outlined.
  for (const [j, past] of [[2, 10], [5, 10], [8, 10], [8, 40], [total - 3, 10]]) {
    await page.locator('#cmp-col-k3 .col__scroll').evaluate((el, [n, by]) => {
      el.scrollTop += el.querySelector(`[data-chg="${n}"]`).getBoundingClientRect().top - el.getBoundingClientRect().top + by;
    }, [j, past]);
    await page.waitForTimeout(250);
    const at = await page.evaluate(() => {
      const top = document.querySelector('#cmp-col-k3 .col__scroll').getBoundingClientRect().top;
      const tag = document.querySelector('#cmp-col-k3 .cur-tag');
      const shown = tag && getComputedStyle(tag).visibility === 'visible';
      return { cut: shown ? top - tag.getBoundingClientRect().top : null, n: document.querySelector('#cmp-col-k3 .u-current')?.dataset.chg || '0', main: document.querySelector('.counter__main').textContent };
    });
    assert.ok(at.cut === null || at.cut <= 0.5, `With change ${j} ${past}px above the top of C, its tag shows cut by ${at.cut}px`);
    assert.equal(at.main.split(' of ')[0], at.n, `The counter (${at.main}) names the outlined change`);
  }

  // ── Sections: lies over the columns at 1440, rows bring sections in ──────
  const sectionsToggle = page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]');
  await sectionsToggle.click();
  await page.locator('#cmpPanel .secmap').waitFor();
  assert.match(await page.locator('#compareView').getAttribute('class'), /panel-open.*panel-overlay|panel-overlay.*panel-open/);
  const contributing = page.locator('#cmpPanel .secmap tr', { hasText: 'Contributing factors' });
  assert.match(await contributing.locator('td[data-col="k1"]').innerText(), /Missing/);
  assert.match(await contributing.locator('td[data-col="k3"]').innerText(), /Missing/);
  assert.equal(await contributing.locator('.miss').first().evaluate((el) => getComputedStyle(el).color === getComputedStyle(document.querySelector('.col__who')).color), true, 'Missing is secondary ink, not red');
  assert.match(await page.locator('#cmpPanel .coverage').innerText(), /covers \d+ of \d+ base sections[\s\S]*Matched by heading text, or by shared wording when the headings differ, never by meaning\./);
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
  // Every mark label reads in full at 360 px, and focus on a chosen mark is
  // an outline outside it, not its chosen ring.
  const cut = await page.evaluate(() => [...document.querySelectorAll('#cmpPanel .seg__word')]
    .filter((w) => w.scrollWidth > w.clientWidth + 0.5 || w.getBoundingClientRect().right > w.parentElement.getBoundingClientRect().right).map((w) => w.textContent));
  assert.deepEqual(cut, [], 'Mark labels are cut short');
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return [document.activeElement.getAttribute('aria-checked'), cs.outlineStyle, parseFloat(cs.outlineOffset)];
  });
  assert.deepEqual(ring, ['true', 'solid', 2], 'Focus on a chosen mark sits outside its ring');
  await page.locator('#cmpPanel .crit[data-crit="accuracy"] .crit__rows').screenshot({ path: path.join(verify, 'compare-review-focus.png') });
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
  // Undo of Remove criterion brings back that criterion, at its place, with
  // its marks, and keeps a note and a mark entered meanwhile.
  await page.locator('#cmpPanel .crit[data-crit="clarity"] > summary').click();
  await mark('k1', 'weak', 'clarity').click();
  await page.locator('#cmpPanel .crit__more[data-crit="clarity"]').click();
  await page.locator('#cmpPanel .crit__menu [data-action="cmp-crit-remove"]').click();
  await page.waitForFunction(() => !document.querySelector('#cmpPanel .crit[data-crit="clarity"]'));
  await page.locator('#cmpPanel textarea[data-note="k1"]').fill('Entered after the removal.');
  await mark('k2', 'strong', 'completeness').click();
  await page.locator('#cmpToast button', { hasText: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelector('#cmpPanel .crit[data-crit="clarity"]'));
  assert.deepEqual(await page.locator('#cmpPanel .crit').evaluateAll((list) => list.map((el) => el.dataset.crit)),
    ['accuracy', 'completeness', 'clarity', 'evidence', 'actionability'], 'The criterion is back at its place');
  assert.equal(await mark('k1', 'weak', 'clarity').getAttribute('aria-checked'), 'true', 'with its marks');
  assert.equal(await mark('k2', 'strong', 'completeness').getAttribute('aria-checked'), 'true', 'A mark entered meanwhile stays');
  assert.equal(await page.locator('#cmpPanel textarea[data-note="k1"]').inputValue(), 'Entered after the removal.', 'A note entered meanwhile stays');
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
  // Sync off, so no column is put back by another: each is read at a place
  // of its own and C has focus. Blind moves the columns on the page and
  // renames the base in their marks ("Removed from Report 3"); every column
  // keeps its place, its drawn text and focus. (Toggled from script, as a
  // click would take focus to the button.)
  await page.locator('select[data-change="cmp-sync"]').selectOption('off');
  await page.evaluate(() => Object.entries({ k1: 300, k2: 600, k3: 450 }).forEach(([col, y]) => {
    Object.assign(document.querySelector(`#cmp-col-${col} .col__scroll`), { __kept: true, scrollTop: y });
  }));
  await page.locator('#cmp-col-k3 .col__scroll').focus();
  await page.waitForTimeout(400);
  const readAt = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#compareView .col')]
    .map((el) => [el.dataset.col, Math.round(el.querySelector('.col__scroll').scrollTop)])));
  const placesBefore = await readAt();
  await page.evaluate(() => document.querySelector('.cmp-toolbar [data-action="cmp-toggle-blind"]').click());
  await page.waitForFunction(() => document.querySelector('#compareView').classList.contains('blind'));
  await page.waitForTimeout(400);
  const placesAfter = await readAt();
  for (const col of ['k1', 'k2', 'k3']) {
    assert.equal(await page.locator(`#cmp-col-${col} .col__scroll`).evaluate((el) => el.__kept), true, `Blind drew ${col} again`);
    assert.ok(Math.abs(placesAfter[col] - placesBefore[col]) <= 2, `Blind lost ${col}'s place: ${placesBefore[col]} then ${placesAfter[col]}`);
  }
  await focusOn(page, '#cmp-col-k3 .col__scroll', 'Blind moved focus');
  const baseNames = await page.locator('#compareView [data-base-ref]').allTextContents();
  const baseLabel = await page.locator('#cmp-col-k2 .col__label').textContent();
  assert.ok(baseNames.length && baseNames.every((n) => n === baseLabel), `The marks name the base as ${[...new Set(baseNames)].join(', ')}, not ${baseLabel}`);
  assert.match(await page.locator('#cmp-col-k1 [data-d="mov"] > .visually-hidden:not(.u-sr)').textContent(), /in Report \d\. $/, 'A move names the base by its report number');
  await page.locator('select[data-change="cmp-sync"]').selectOption('sections');
  // Report order is the page's own order, so print, Tab and a screen reader
  // meet the reports in the order the screen shows them, never the order
  // they were added in, which can say who wrote which.
  const pageOrder = await page.evaluate(() => [...document.querySelectorAll('#compareView .col')].map((el) => ({
    label: el.querySelector('.col__label').textContent, left: el.getBoundingClientRect().left, order: el.style.order,
  })));
  assert.deepEqual(pageOrder.map((c) => c.label), ['Report 1', 'Report 2', 'Report 3'], 'The page holds the columns in report order');
  assert.deepEqual([...pageOrder].sort((a, b) => a.left - b.left).map((c) => c.label), pageOrder.map((c) => c.label), 'The screen shows the columns in the page order');
  assert.ok(pageOrder.every((c) => c.order === ''), 'Blind still orders the columns with CSS order');
  const blind = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent).join(' | ');
    return {
      labels: [...document.querySelectorAll('#compareView .col__label')].map((el) => el.textContent),
      // The against menu too, closed: it is rebuilt under Blind before it opens.
      visible: [q('#compareView .col__head'), q('.focus-switch'), q('#cmpAgainst'), q('#cmpDiffMenu'), q('#cmpPanel'), q('.cmp-toolbar .set-title'),
        document.querySelector('#cmpAgainst').getAttribute('aria-label'), document.title].join(' || '),
      stripe: getComputedStyle(document.querySelector('#cmp-col-k1 .col__head')).borderTopColor,
      neutral: getComputedStyle(document.querySelector('#cmp-col-k3 .col__head')).borderTopColor,
    };
  });
  assert.deepEqual([...blind.labels].sort(), ['Report 1', 'Report 2', 'Report 3']);
  assert.match(await page.locator('#cmpDiffMenu').evaluate((el) => (el.hidden ? el.textContent : '')), /Report 1[\s\S]*Report 2[\s\S]*Report 3/, 'The closed against menu lists the reports');
  // File names too: the who line names a column's file once Blind is off.
  for (const word of ['Human', 'Agent', 'Fixes', 'Whitfield', 'agent run', 'Illustrative example', 'human-draft', 'agent-output', 'fixes.html']) {
    assert.ok(!blind.visible.includes(word), `Blind still shows "${word}"`);
  }
  const heads = await page.locator('#compareView .col__head').allTextContents();
  assert.ok(!/Markdown|HTML|Dossier/.test(heads.join(' ')), 'Blind still shows what kind each report is');
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
  // Report 1 is the leftmost column, clear of the Review panel over the
  // right whatever the shuffle dealt (the seeded order put B under it in
  // about one run in three).
  const first = await firstReport(page);
  await page.locator(`#cmp-col-${first} [data-action="cmp-column-menu"]`).click();
  assert.equal(await page.locator('#cmpColumnMenu').getAttribute('aria-label'), 'Report 1 options');
  assert.equal(await page.locator('#cmpColumnMenu [data-action="cmp-details"]').isDisabled(), true, 'Label, role and author waits for Blind to be off');
  assert.deepEqual(await page.locator('#cmpColumnMenu [data-action="cmp-move"]').evaluateAll((list) => list.map((b) => b.disabled)), [true, true], 'Moves wait for Blind to be off');
  await page.keyboard.press('Escape');
  // The markup keeps the secret: no real role on anything but the Add menu's choices.
  const roles = await page.evaluate(() => [...document.querySelectorAll('#compareView [data-role]')]
    .filter((el) => !el.closest('#cmpAddMenu')).map((el) => el.dataset.role));
  assert.ok(roles.length > 5 && roles.every((r) => r === 'other'), `Blind leaves roles in the markup: ${[...new Set(roles)].join(', ')}`);
  // Edit source names the report, not the column letter or the file.
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
  assert.match(await page.locator('#cmpPanel .rec').innerText(), /^Marks were entered with Blind on/);
  // Which column each number was stays out of the panel while Blind is on.
  assert.equal(await page.locator('#cmpPanel .rec__order').isHidden(), true, 'The panel decodes the report numbers under Blind');
  assert.equal(await page.locator('#cmpPanel .rec__order').textContent(), '');
  await page.locator('.cmp-toolbar [data-action="cmp-toggle-blind"]').click();
  await page.waitForFunction(() => !document.querySelector('#compareView').classList.contains('blind'));
  assert.match(await page.locator('#cmp-col-k1 .col__label').evaluate((el) => el.textContent), /^Column A, Human draft$/, 'Reveal brings the names back');
  assert.match(await page.locator('#cmpPanel .rec').innerText(), /^Marks were entered with Blind on/, 'Turning Blind off keeps the blind note');
  assert.ok(!(await page.locator('#cmpPanel .rec').innerText()).includes('Reveal'), 'The note names a Reveal control there is none of');
  // Once Blind is off, the panel says which column Report 1 was: the leftmost while blind.
  assert.match(await page.locator('#cmpPanel .rec__order').innerText(), new RegExp(`^While blind: Report 1 was ${{ k1: 'A', k2: 'B', k3: 'C' }[first]} \\([^)]+\\), Report 2 was [A-C] \\(`));
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#compareView .col')].map((el) => el.dataset.col)), ['k1', 'k2', 'k3'], 'Reveal puts the columns back in their own order');

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: the example opening with each column against its source (A the base, B against A, C against B) and the choice in the menu, difference marks on the example (C against B with hidden words, labels, ghost rows and one ruler tick per change; A too different, with Word marks on and off, the tag of a table row, and one moved section with its label and ruler tick), one Original notice, Show removed words, a new base and back, the counter on change 1 when the example opens, ] and [ with the counter, the tag and the announcement, a ruler tick, sync following, ] to the last change fast and at a normal pace, a tag never cut at the top of its column, the Sections panel over the columns (Missing in secondary ink, coverage, a row on the reading line of every column, Escape, a panel starting at its top), the Review panel (marks by click and arrow key, kept on Space, a focus ring outside the chosen ring, every label in full at 360 px, the criterion menu, Clear marks and its undo, the undo of Remove criterion keeping what was entered since, preferred, notes, summary, counts only, copied as Markdown, kept across a reload, docked at 1680 and by the pin), and Blind (numbers, report order in the page as on screen, every column keeping its place, text and focus with Sync off, the base renamed in its marks, neutral stripes, no names in the heads, the closed against menu, the switcher or the column menu of Report 1, roles, ids and file names kept out of the markup and a blind file, recorded while blind in words that name the Blind toggle, Blind off with the added order back and which column each report number was).');
} finally {
  await browser.close();
}
