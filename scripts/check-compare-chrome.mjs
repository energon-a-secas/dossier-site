/**
 * Browser checks for the Compare view's chrome, and the segmented rows it
 * shares with the Reports view: the toolbar (nothing painted over the
 * against picker at any width, with WCAG text spacing too), the Add column
 * tile where the toolbar folds Add column away, column heads in a short
 * window (and a difference line on one row), the phone switcher with four
 * columns (and in the exported file), change glyphs a screen reader does not
 * read, the focus ring on a report frame (Compare's Original, and the Reports
 * view), the HTML bar's render mode row (one order, one keyboard model), and
 * the edit pane's Form and JSON tabs.
 *
 * Run by scripts/check-compare.mjs at its end, or alone:
 * `node scripts/check-compare-chrome.mjs` (DOSSIER_URL overrides
 * http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  base, file, out, watch, noOverflow, focusOn,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];

async function openExample(page) {
  await page.locator('#openReport').click();
  await page.locator('#openExamples [data-action="cmp-example"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 3);
  await page.locator('#cmp-col-k3 .ruler').waitFor();
}

/**
 * No two toolbar controls overlap, and the against picker's name and caret
 * are the picker where they show. Between 1100 and 1260 px Previous and the
 * counter used to paint over the base's name, so a click on it stepped back.
 */
async function toolbarClear(page, label) {
  const found = await page.evaluate(() => {
    const desc = (el) => (el ? `${el.localName}${el.id ? `#${el.id}` : ''}[${(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)}]` : 'nothing');
    const els = [...new Set(document.querySelectorAll('#cmpToolbar button, #cmpToolbar select, #cmpToolbar .counter, #cmpToolbar .picker'))]
      .filter((el) => el.getClientRects().length);
    const overlaps = [];
    for (let i = 0; i < els.length; i += 1) {
      for (let j = i + 1; j < els.length; j += 1) {
        const [a, b] = [els[i], els[j]];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (x > 1 && y > 1) overlaps.push(`${desc(a)} and ${desc(b)} by ${Math.round(x)}px`);
      }
    }
    const hit = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return at?.closest('#cmpAgainst') ? 'ok' : desc(at);
    };
    return { overlaps, name: hit('#cmpAgainst .picker__name'), caret: hit('#cmpAgainst .caret') };
  });
  assert.deepEqual(found.overlaps, [], `${label}: toolbar controls overlap`);
  assert.equal(found.name, 'ok', `${label}: the base's name is under ${found.name}`);
  assert.equal(found.caret, 'ok', `${label}: the picker's caret is under ${found.caret}`);
}

const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }';

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=chrome-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  await openExample(page);

  // ── Change glyphs are drawn, not read ──────────────────────────────────────
  const snapshot = await page.locator('#compareView').ariaSnapshot();
  const read = snapshot.split('\n').filter((line) => /\s[~+−]"(\s|$)/.test(line) || /- text: [~+−]\s*$/.test(line));
  assert.deepEqual(read, [], 'A screen reader hears a change glyph');
  assert.equal(await page.locator('#compareView .reader .u-changed, #compareView .reader .u-bar-chg').first()
    .evaluate((el) => getComputedStyle(el, '::after').content), '"~" / ""', 'The changed glyph is not drawn with empty alt text');

  // ── The toolbar: nothing over the against picker, at any width ─────────────
  for (const width of [700, 1100, 1160, 1200, 1260, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    await toolbarClear(page, `${width}px`);
  }
  await page.addStyleTag({ content: SPACING });
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    await toolbarClear(page, `${width}px with WCAG text spacing`);
    await noOverflow(page, `${width}px with WCAG text spacing`);
  }
  await page.evaluate(() => [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('word-spacing: 0.16em')).forEach((s) => s.remove()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.getElementById('compareView').classList.contains('is-tight')), false, 'The measured fold stayed on at 1440 with normal spacing');
  // The Options button keeps its 36 px where the row is tightest.
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#cmpOptionsBtn').evaluate((el) => el.getBoundingClientRect().width) >= 32, 'The Options button shrank under its size');

  // ── A Dossier frame's focus ring, in Compare's Original layout ─────────────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.cmp-toolbar [data-action="cmp-set-mode"][data-value="original"]').click();
  await page.locator('#cmp-col-k1 .col__frame').waitFor();
  await page.waitForTimeout(300);
  await page.locator('#cmp-col-k1 .col__menu').focus();
  let framed = false;
  for (let i = 0; i < 4 && !framed; i += 1) {
    await page.keyboard.press('Tab');
    framed = await page.evaluate(() => document.activeElement?.matches?.('iframe.col__frame'));
  }
  assert.ok(framed, 'Tab from Column A options never reached its frame');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'A focused Original frame shows no ring');
  for (let i = 0; i < 12 && await page.evaluate(() => document.activeElement?.localName === 'iframe'); i += 1) await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('iframe[data-focus-ring]').count(), 0, 'A frame kept its ring after focus left it');
  await page.locator('.cmp-toolbar [data-action="cmp-set-mode"][data-value="format"]').click();
  await page.locator('#cmp-col-k1 .col__scroll').waitFor();

  // ── The file, on a phone: the switcher's tabs keep their words or letters ─
  await page.locator('#shareReport').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-html"]').click()]);
  const exported = out('compare-export-chrome.html');
  await download.saveAs(exported);
  const small = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true });
  const sp = await small.newPage();
  watch({ page: sp, errors });
  await sp.goto(pathToFileURL(exported).href);
  await sp.waitForTimeout(300);
  const fileTabs = await sp.evaluate(() => {
    const sw = document.querySelector('.focus-switch');
    const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    return {
      fits: sw.scrollWidth <= sw.clientWidth + 1,
      badges: [...sw.querySelectorAll('[role="tab"]')].every((tab) => inside(tab.querySelector('.rb').getBoundingClientRect(), tab.getBoundingClientRect())),
      words: [...sw.querySelectorAll('.focus-switch__word')].map((w) => w.getBoundingClientRect().width <= 1 || w.scrollWidth <= w.clientWidth + 1),
    };
  });
  assert.ok(fileTabs.fits, 'The file\'s phone switcher runs past its row');
  assert.ok(fileTabs.badges, 'A badge in the file\'s phone switcher sits outside its tab');
  assert.ok(fileTabs.words.every(Boolean), 'A word in the file\'s phone switcher is cut short');
  await small.close();

  // ── The Add column tile, where the toolbar folds Add column away ───────────
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.cmp-toolbar [data-action="cmp-add-menu"]').isVisible(), false);
  const tile = page.locator('#cmpColumns > .cmp-addcol button');
  assert.equal(await tile.isVisible(), true, 'No Add column tile at 1280 with three columns');
  assert.equal(await page.getByRole('button', { name: 'Add column', exact: true }).count(), 1);
  await noOverflow(page, 'The tile at 1280');
  await tile.click();
  const menu = await page.evaluate(() => ({
    shown: !document.getElementById('cmpAddMenu').hidden,
    top: document.getElementById('cmpAddMenu').getBoundingClientRect().top,
    bottom: document.getElementById('cmpAddMenu').getBoundingClientRect().bottom,
    header: document.querySelector('.header-bar').getBoundingClientRect().bottom,
    window: innerHeight,
  }));
  assert.ok(menu.shown && menu.top >= menu.header && menu.bottom <= menu.window, `The tile's menu is off screen (${JSON.stringify(menu)})`);
  await page.keyboard.press('Escape');
  await focusOn(page, '#cmpColumns > .cmp-addcol button', 'Escape did not return focus to the tile');
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(200);
  assert.equal(await tile.isVisible(), false, 'The tile shows at 1100 with three columns');
  assert.ok(await page.locator('#cmpColumns').evaluate((el) => el.scrollWidth - el.clientWidth) <= 0, 'The columns scroll sideways at 1100');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(await tile.isVisible(), false, 'The tile shows beside the toolbar\'s own Add column');
  assert.equal(await page.locator('.cmp-toolbar [data-action="cmp-add-menu"]').isVisible(), true);

  // ── Column heads in a short window, and a difference line on one row ──────
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(250);
  const tooDifferent = await page.evaluate(() => document.querySelector('#compareView .col__diff .col__words')?.closest('.col')?.id);
  assert.ok(tooDifferent, 'The example has no column too different to mark word by word');
  const line = await page.evaluate((id) => {
    const diff = document.querySelector(`#${id} .col__diff`);
    const key = diff.querySelector('.key');
    return {
      height: diff.getBoundingClientRect().height,
      words: diff.querySelector('.col__words').getBoundingClientRect().top,
      count: diff.querySelector('.col__count').getBoundingClientRect().top,
      key: key?.textContent || '',
      keyWidth: key ? key.getBoundingClientRect().width : 0,
    };
  }, tooDifferent);
  assert.ok(line.height <= 40, `The difference line wraps to ${line.height}px`);
  assert.ok(Math.abs(line.words - line.count) <= 4, 'Word marks is not on the count\'s row');
  assert.match(line.key, /changed|added|removed/, 'The changed, added and removed parts left the line');
  assert.ok(line.keyWidth <= 1, 'The plain parts still take room on the line');
  await page.locator(`#${tooDifferent} .col__words`).click();
  await page.waitForFunction((id) => [...document.querySelectorAll(`#${id} .col__diff .key > span:not(.visually-hidden)`)].some((el) => el.getBoundingClientRect().width > 20), tooDifferent)
    .catch(() => assert.fail('With Word marks on, the coloured parts do not show'));
  await page.locator(`#${tooDifferent} .col__words`).click();

  await page.setViewportSize({ width: 720, height: 450 });
  await page.waitForTimeout(300);
  // The heads come down to the badge row and the difference line.
  const heads = () => page.evaluate(() => ({
    lines: [...document.querySelectorAll('#compareView .col__who, #compareView .col__stats')].map((el) => [el.getBoundingClientRect().height, el.textContent.trim().length]),
    text: document.querySelector('#cmp-col-k2 .col__scroll').clientHeight,
    head: document.querySelector('#cmp-col-k2 .col__head').getBoundingClientRect().height,
    parts: Math.max(...[...document.querySelectorAll('#compareView .col__head')].map((h) => h.querySelector('.col__row').getBoundingClientRect().height
      + (h.querySelector('.col__diff')?.getBoundingClientRect().height || 0))),
  }));
  const compact = await heads();
  assert.ok(compact.lines.length && compact.lines.every(([h, n]) => h <= 1 && n > 0), `In a short window the who and stats lines take room, or lost their words (${JSON.stringify(compact.lines)})`);
  assert.ok(compact.head <= compact.parts + 16, `A ${compact.head}px head holds more than its ${compact.parts}px badge row and difference line`);
  assert.ok(compact.text >= 150, `The text gets ${compact.text}px of a 450px window`);
  await page.locator('#cmp-col-k1 .col__menu').click();
  const details = page.locator('#cmpColumnMenu [data-action="cmp-head-details"]');
  assert.equal(await details.innerText(), 'Show role, author and counts');
  await details.click();
  await focusOn(page, '#cmp-col-k1 [data-action="cmp-column-menu"]', 'Showing the head details lost focus');
  const full = await page.evaluate(() => ({
    who: [...document.querySelectorAll('#compareView .col__who')].map((el) => el.getBoundingClientRect().height),
    heads: [...document.querySelectorAll('#compareView .col__head')].map((el) => Math.round(el.getBoundingClientRect().height)),
  }));
  assert.ok(full.who.every((h) => h > 10), 'The who lines did not come back');
  assert.equal(new Set(full.heads).size, 1, `The heads are not one height (${full.heads})`);
  assert.ok(full.heads[0] >= compact.head + 25, `Compact heads (${compact.head}px) save little against full ones (${full.heads[0]}px)`);
  await page.locator('#cmp-col-k1 .col__menu').click();
  assert.equal(await details.innerText(), 'Hide role, author and counts');
  await details.click();
  await page.locator('#cmp-col-k1 .col__menu').click();
  for (let i = 0; i < 20 && await page.evaluate(() => document.activeElement?.dataset.action !== 'cmp-remove'); i += 1) await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'cmp-remove', 'ArrowDown never reached Remove column');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await page.locator('#cmp-col-k1 .col__menu').click();
  assert.equal(await page.locator('#cmpColumnMenu [data-action="cmp-head-details"]').count(), 0, 'A tall window offers the head details');
  await page.keyboard.press('Escape');

  // ── Four columns: the tile goes, and the phone switcher keeps whole words ─
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  await tile.click();
  await page.locator('#cmpAddMenu [data-action="cmp-add-column"][data-role="fix"]').click();
  await focusOn(page, '#cmp-col-k4 [data-action="cmp-choose-file"]', 'A column added from the tile did not take focus');
  assert.equal(await tile.isVisible(), false, 'The tile shows with four columns');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const tabs = await page.evaluate(() => {
    const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    return [...document.querySelectorAll('.cmp-toolbar .focus-switch [role="tab"]')].map((tab) => {
      const word = tab.querySelector('.focus-switch__word');
      return {
        selected: tab.getAttribute('aria-selected') === 'true',
        width: word.getBoundingClientRect().width,
        cut: word.scrollWidth > word.clientWidth + 1,
        badge: inside(tab.querySelector('.rb').getBoundingClientRect(), tab.getBoundingClientRect()),
      };
    });
  });
  assert.equal(tabs.length, 4);
  for (const tab of tabs) {
    assert.ok(tab.badge, 'A badge sits outside its tab');
    if (tab.selected) assert.ok(tab.width > 1 && !tab.cut, 'The chosen tab\'s word is cut short');
    else assert.ok(tab.width <= 1, 'A tab that is not chosen still shows its word');
    assert.ok(!(tab.width > 1 && tab.cut), 'A word ends in an ellipsis');
  }
  assert.equal(await page.getByRole('tab', { name: /Human/ }).count(), 1, 'The role word left the tab\'s name');
  await noOverflow(page, 'Four columns at 390');
  // The phone's column menu hides "Focus on this column"; ArrowDown passes it.
  await page.locator('.focus-switch [role="tab"][data-col="k1"]').click();
  await page.locator('#cmp-col-k1 .col__menu').click();
  for (let i = 0; i < 20 && await page.evaluate(() => document.activeElement?.dataset.action !== 'cmp-remove'); i += 1) await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'cmp-remove', 'ArrowDown on a phone never reached Remove column');
  await page.keyboard.press('Escape');
  await context.close();

  await checkReportsRows();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: change glyphs drawn with empty alt text, so no heading or line is read with a tilde, plus or minus; toolbar controls that never overlap and an against picker that is itself where its name and caret show at 700, 1100, 1160, 1200, 1260 and 1440, and at 1100 and 1440 with WCAG text spacing, the Options button keeping its size; a ring on a focused Original frame that goes when focus leaves it; the exported file\'s phone switcher with every badge in its tab and no word cut; the Add column tile at 1280 with its menu on screen and focus back on Escape, gone at 1100, at 1440 and with four columns, and a column added from it taking focus; a too different column\'s difference line on one row with Word marks, its parts kept for a screen reader and shown with Word marks on; compact column heads at 720x450 that the column menu opens and closes again, with focus back on the menu button; ArrowDown reaching Remove column at 720 and on a phone; the four-column phone switcher with the chosen tab\'s word whole and the others as letters; and in the Reports view, the HTML bar\'s Dossier format and Original as one radio group with one Tab stop and the arrow keys, a ring on the focused report frame, and Form and JSON tabs that follow the arrow keys, Home and End.');
} finally {
  await browser.close();
}

/** The Reports view's HTML bar, its frame's ring, and the edit pane's tabs. */
async function checkReportsRows() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=reports-rows-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles(file('fixtures/embed/tall-report.html'));
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  await page.locator('#stage iframe.block-embed--static').waitFor();

  // One order, one keyboard model: Dossier format then Original, as in the
  // Compare toolbar, then the scripts toggle beside the view it changes.
  const bar = await page.locator('#stage .embed-bar button').allInnerTexts();
  assert.deepEqual(bar.map((t) => t.trim()), ['Dossier format', 'Original', 'Run the report’s scripts']);
  const original = page.getByRole('radio', { name: 'Original', exact: true });
  const format = page.getByRole('radio', { name: 'Dossier format', exact: true });
  assert.equal(await original.getAttribute('aria-checked'), 'true');
  assert.equal(await original.evaluate((el) => el.tabIndex), 0);
  assert.equal(await format.evaluate((el) => el.tabIndex), -1, 'Each radio is its own Tab stop');
  await original.focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('embed-bar__scripts')), 'Tab from Original did not go on to the scripts toggle');
  // The report's own frame shows a ring when Tab reaches it.
  let framed = false;
  for (let i = 0; i < 6 && !framed; i += 1) {
    await page.keyboard.press('Tab');
    framed = await page.evaluate(() => document.activeElement?.matches?.('iframe.block-embed--static'));
  }
  assert.ok(framed, 'Tab never reached the report frame');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'The focused report frame shows no ring');
  await original.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#stage .block-embed-html--live')?.dataset.embedView === 'format');
  await focusOn(page, '#stage .embed-bar__views [data-view="format"]', 'ArrowLeft moved focus off the row');
  assert.equal(await page.locator('#stage iframe[data-focus-ring]').count(), 0, 'A frame that is gone kept its ring');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#stage .block-embed-html--live')?.dataset.embedView === 'original');
  await focusOn(page, '#stage .embed-bar__views [data-view="original"]', 'ArrowRight moved focus off the row');

  // The edit pane's Form and JSON tabs: one Tab stop, the arrow keys move.
  await page.locator('#toggleMode').click();
  await page.locator('#tabForm').waitFor();
  await page.locator('#tabForm').focus();
  await page.keyboard.press('ArrowRight');
  const json = await page.evaluate(() => ({
    active: document.activeElement?.id,
    selected: document.getElementById('tabJson').getAttribute('aria-selected'),
    jsonTab: document.getElementById('tabJson').tabIndex,
    formTab: document.getElementById('tabForm').tabIndex,
    pane: document.getElementById('jsonPane').hidden,
  }));
  assert.deepEqual(json, { active: 'tabJson', selected: 'true', jsonTab: 0, formTab: -1, pane: false }, 'ArrowRight on Form did not choose JSON');
  await page.keyboard.press('Home');
  const form = await page.evaluate(() => ({
    active: document.activeElement?.id,
    selected: document.getElementById('tabForm').getAttribute('aria-selected'),
    jsonTab: document.getElementById('tabJson').tabIndex,
    formTab: document.getElementById('tabForm').tabIndex,
  }));
  assert.deepEqual(form, { active: 'tabForm', selected: 'true', jsonTab: -1, formTab: 0 }, 'Home did not go back to Form');
  await page.locator('#toggleMode').click();
  await context.close();
}
