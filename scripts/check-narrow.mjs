/**
 * Browser regressions at narrow widths, run by scripts/check-workspace.mjs:
 * one header from the first paint, a reachable view switch, the rail as a
 * drawer under the kit's phone menu, no sideways overflow, header controls
 * that never overlap, and focus back from the phone menu. Also the helpers
 * the workspace check shares: no overflow, and exactly one header bar.
 * Split out of check-workspace.mjs when it passed the 500 line cap.
 */
import assert from 'node:assert/strict';
import { recordFrames, checkFirstPaint } from './check-boot.mjs';

export async function noOverflow(target, label) {
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} overflows the viewport`);
}

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
      await narrow.screenshot({ path: '.verify/report-mobile.png', fullPage: true });
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
        const input = document.getElementById('importFile').getBoundingClientRect();
        const dialog = document.getElementById('importDialog').getBoundingClientRect();
        return { input: input.right, dialog: dialog.right };
      });
      assert.ok(file.input <= file.dialog, 'The file input runs past the Open dialog');
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
