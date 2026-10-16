/**
 * Browser regressions at narrow widths, run by scripts/check-workspace.mjs:
 * one header from the first paint, a reachable view switch, the rail as a
 * drawer under the kit's phone menu, no sideways overflow, header controls
 * that never overlap, focus back from the phone menu, a drawer that closes
 * when Tab leaves it and an Escape that brings its toggle into view, and the
 * welcome examples in full rows. Also the helper
 * the workspace check shares: exactly one header bar. No overflow is in
 * scripts/check-helpers.mjs, with the rest of what the checks share.
 * Split out of check-workspace.mjs when it passed the 500 line cap.
 */
import assert from 'node:assert/strict';
import { recordFrames, checkFirstPaint } from './check-boot.mjs';
import { noOverflow, out } from './check-helpers.mjs';

/** Header bars the reader can see right now. There must never be more than one. */
export function visibleBars(target) {
  return target.evaluate(() => [...document.querySelectorAll('.header-bar, header[class*="workbar"], .ds-workbar')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').length);
}

export async function oneHeader(target, label) {
  assert.equal(await visibleBars(target), 1, `${label}: expected exactly one visible header bar`);
}

/** Narrow windows: one header, a reachable view switch, no overflow. */
export async function checkNarrow({ browser, base, errors }) {
  for (const width of [390, 768, 1024]) {
    const narrow = await browser.newPage({ viewport: { width, height: 844 } });
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.addInitScript(recordFrames);
    await narrow.goto(`${base}/?check=${width}`, { waitUntil: 'networkidle' });
    await checkFirstPaint(narrow, `${width}px first visit`);
    await noOverflow(narrow, `${width}px welcome`);
    // The four welcome cards fill whole rows: 1+1+1+1, 2+2 or 4, never 3+1.
    await narrow.locator('#welcomeExamples .ds-example').nth(3).waitFor();
    const rows = await narrow.evaluate(() => {
      const counts = new Map();
      for (const li of document.getElementById('welcomeExamples').children) {
        const top = Math.round(li.getBoundingClientRect().top);
        counts.set(top, (counts.get(top) || 0) + 1);
      }
      return [...counts.values()];
    });
    assert.ok(rows.every((n) => n === rows[0]), `${width}px welcome examples leave a card alone on a row: ${rows.join('+')}`);
    await narrow.locator('#welcomeExamples [data-file="responses.json"]').click();
    await narrow.locator('#stage .compare').waitFor();
    await oneHeader(narrow, `${width}px report`);
    // Below docking width the rail starts closed and opens as a drawer.
    assert.equal(await narrow.locator('#rail').isVisible(), false, `${width}px opened with the rail over the report`);
    await narrow.locator('#toggleRail').click();
    assert.equal(await narrow.locator('#rail').isVisible(), true);
    if (width === 390) {
      // The kit's phone menu opens over the drawer, never under it: the point
      // at the middle of its Open row is the Open button.
      await narrow.locator('.header-overflow-toggle').click();
      const hit = await narrow.evaluate(() => {
        const button = document.getElementById('openReport');
        const box = button.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { ok: Boolean(top && button.contains(top)), at: top ? (top.id || top.className || top.tagName) : null };
      });
      assert.ok(hit.ok, `With the drawer open, the menu's Open row is covered by ${hit.at}`);
      // Display options reads as words in the menu, like Open and Share.
      assert.match(await narrow.locator('#displayOptions').innerText(), /Display options/);
      await narrow.locator('.header-overflow-toggle').click();
    }
    await narrow.keyboard.press('Escape');
    assert.equal(await narrow.locator('#rail').isVisible(), false, 'Escape did not close the rail drawer');
    // Tab past the drawer's last control closes it: focus never sits on a
    // control the drawer covers (WCAG 2.4.11).
    await narrow.locator('#toggleRail').focus();
    await narrow.keyboard.press('Enter');
    assert.equal(await narrow.locator('#rail').isVisible(), true);
    for (let i = 0; i < 20 && await narrow.evaluate(() => document.getElementById('rail').contains(document.activeElement)); i += 1) {
      await narrow.keyboard.press('Tab');
    }
    const left = await narrow.evaluate(() => {
      const toggle = document.getElementById('toggleRail');
      const box = toggle.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { rail: document.documentElement.dataset.dossierRail, focused: document.activeElement === toggle, onTop: Boolean(hit && toggle.contains(hit)) };
    });
    assert.deepEqual(left, { rail: 'closed', focused: true, onTop: true }, `${width}px: Tab out of the drawer`);
    // Escape after scrolling brings the toggle back into view with focus.
    await narrow.locator('#toggleRail').click();
    const hidden = await narrow.evaluate(() => {
      window.scrollTo(0, 900);
      return document.getElementById('toggleRail').getBoundingClientRect().bottom <= 0;
    });
    assert.ok(hidden, `${width}px: the page did not scroll the toggle away, so this proves nothing`);
    await narrow.keyboard.press('Escape');
    const back = await narrow.evaluate(() => {
      const box = document.getElementById('toggleRail').getBoundingClientRect();
      return { rail: document.documentElement.dataset.dossierRail, inView: box.top >= 0 && box.bottom <= innerHeight, focused: document.activeElement?.id === 'toggleRail' };
    });
    assert.deepEqual(back, { rail: 'closed', inView: true, focused: true }, `${width}px: Escape after a scroll left the toggle off screen`);
    await narrow.evaluate(() => window.scrollTo(0, 0));
    await noOverflow(narrow, `${width}px report`);
    await narrow.locator('#stage').getByRole('link', { name: 'Scores & runs' }).click();
    await narrow.locator('#stage .grouped-chart').waitFor();
    await noOverflow(narrow, `${width}px charts`);
    await narrow.locator('#toggleMode').click();
    await noOverflow(narrow, `${width}px editor`);
    // The header controls never overlap: the menu button ends before home.
    const overlap = await narrow.evaluate(() => {
      const controls = [...document.querySelectorAll('.header-actions > *, .header-home')]
        .filter((el) => el.getClientRects().length).map((el) => el.getBoundingClientRect());
      return controls.some((a, i) => controls.some((b, j) => i < j && a.right > b.left + 1 && b.right > a.left + 1));
    });
    assert.equal(overlap, false, `${width}px header controls overlap`);
    if (width === 390) {
      await narrow.screenshot({ path: out('report-mobile.png'), fullPage: true });
      // The other view is one tap away on a phone; the current one steps aside.
      assert.equal(await narrow.locator('#viewCompare').isVisible(), true);
      await narrow.locator('#viewCompare').click();
      await narrow.locator('#compareView .cmp-toolbar').waitFor();
      await noOverflow(narrow, 'Mobile Compare view');
      assert.equal(await narrow.locator('#viewReports').isVisible(), true);
      // Open, Share and Display wait in the kit's menu.
      await narrow.locator('.header-overflow-toggle').click();
      assert.equal(await narrow.locator('#openReport').isVisible(), true);
      await narrow.locator('#openReport').click();
      await noOverflow(narrow, 'Mobile Open dialog');
      const file = await narrow.evaluate(() => {
        const button = document.querySelector('#importDialog [data-action="import-choose-file"]').getBoundingClientRect();
        const dialog = document.getElementById('importDialog').getBoundingClientRect();
        return { button: button.right, dialog: dialog.right };
      });
      assert.ok(file.button <= file.dialog, 'The Choose a file button runs past the Open dialog');
      // The platform control is hidden; the product button drives it.
      assert.equal(await narrow.locator('#importFile').isVisible(), false, 'The platform file control shows in the Open dialog');
      // Open sat in the kit's menu, which closed when it was pressed, so
      // Cancel puts focus on the menu button, never on <body>.
      await narrow.locator('#importDialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      // The dialog's close event, which moves focus, arrives on a later task.
      await narrow.waitForFunction(() => !document.getElementById('importDialog').contains(document.activeElement));
      const focused = await narrow.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
      assert.equal(focused, 'header-overflow-toggle', `Closing Open from the phone menu left focus on ${focused}`);
    }
    await narrow.close();
  }
}
