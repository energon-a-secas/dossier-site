/**
 * Browser regressions for details of a rendered report, run by
 * scripts/check-workspace.mjs after check-reports.mjs:
 *
 * - A trend chart keeps a fixed height, 13 px value labels that do not
 *   overlap, x labels under their points and no sideways scroll; on a phone
 *   only the last values show (js/render/trend.js).
 * - Dates in the file label read "8 Oct 2026" in a zone west of UTC, where
 *   parsing "2026-10-08" as UTC midnight used to print 7 October, and a
 *   window in one month reads "1 to 15 Oct 2026" on one line.
 * - Prose in a comparison block has no empty paragraphs: a blank line is a
 *   paragraph's space (17 px), not a 44 px hole.
 *
 * Each check opens its own browser context.
 */
import assert from 'node:assert/strict';
import { file } from './check-helpers.mjs';
import { fresh, openReport } from './check-reports.mjs';

export async function checkReportDetails({ browser, base, errors }) {
  await trendChartFits({ browser, base, errors });
  await fileLabelDates({ browser, base, errors });
  await proseParagraphs({ browser, base, errors });
}

async function openResponses(page) {
  await openReport(page, { file: file('reports/responses.json'), title: 'Two responses' });
}

async function trendChartFits({ browser, base, errors }) {
  for (const width of [1440, 390]) {
    const { context, page } = await fresh(browser, base, errors, `trend-${width}`, { viewport: { width, height: 900 } });
    await openResponses(page);
    await page.locator('#stage').getByRole('link', { name: 'Scores & runs' }).click();
    const chart = page.locator('#stage .trend-chart');
    await chart.waitFor();
    await chart.scrollIntoViewIfNeeded();
    const m = await chart.evaluate((fig) => {
      const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
      const centre = (r) => r.left + r.width / 2;
      const values = [...fig.querySelectorAll('.trend-value')].filter(visible).map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, size: getComputedStyle(el).fontSize, box: { l: r.left, r: r.right, t: r.top, b: r.bottom } };
      });
      const dots = [...fig.querySelectorAll('.trend-dot')].slice(0, fig.querySelectorAll('.trend-x > span').length).map((el) => centre(el.getBoundingClientRect()));
      const xs = [...fig.querySelectorAll('.trend-x > span')].filter(visible).map((el) => centre(el.getBoundingClientRect()));
      return {
        plot: fig.querySelector('.trend-plot').getBoundingClientRect().height,
        values,
        dots,
        xs,
        ticks: [...fig.querySelectorAll('.trend-y > span:not(.trend-y__sizer)')].map((el) => getComputedStyle(el).fontSize),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inner: fig.scrollWidth - fig.clientWidth,
      };
    });
    assert.ok(m.overflow <= 0 && m.inner <= 0, `At ${width}px the trend chart scrolls sideways (${m.overflow}px page, ${m.inner}px figure)`);
    assert.ok(m.ticks.every((size) => size === '13px'), `At ${width}px the trend's ticks are ${m.ticks.join(', ')}`);
    if (width === 1440) {
      assert.ok(m.plot <= 260, `The trend plot is ${m.plot}px tall at 1440px`);
      assert.equal(m.values.length, 10, `Expected 10 value labels, saw ${m.values.length}`);
      assert.ok(m.values.every((v) => v.size === '13px'), `Value labels are ${[...new Set(m.values.map((v) => v.size))].join(', ')}`);
      for (let i = 0; i < m.values.length; i += 1) {
        for (let j = i + 1; j < m.values.length; j += 1) {
          const a = m.values[i].box;
          const b = m.values[j].box;
          const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
          assert.ok(!overlap, `Value labels ${m.values[i].text} and ${m.values[j].text} overlap`);
        }
      }
      assert.equal(m.xs.length, m.dots.length, 'An x label is missing at 1440px');
      m.xs.forEach((x, i) => {
        const room = i === 0 || i === m.xs.length - 1 ? 14 : 2;
        assert.ok(Math.abs(x - m.dots[i]) <= room, `X label ${i + 1} sits ${Math.round(x - m.dots[i])}px from its point`);
      });
    } else {
      assert.equal(m.values.length, 2, `At 390px expected only the 2 last values, saw ${m.values.length}`);
    }
    await context.close();
  }
}

async function fileLabelDates({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'dates', { viewport: { width: 1440, height: 900 }, timezoneId: 'America/Santiago' });
  const ddFor = (term) => page.locator('#stage .file-label dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');
  await openReport(page, { file: file('reports/incident.json'), title: 'Database failover incident' });
  const date = ddFor('Date');
  assert.equal((await date.innerText()).trim(), '8 Oct 2026', 'The incident\'s date did not read 8 Oct 2026 west of UTC');
  assert.equal(await date.locator('time[datetime="2026-10-08"]').count(), 1, 'The date lost its machine-readable time element');
  await openReport(page, { file: file('reports/sprint.json'), title: 'Sprint 42 summary' });
  const window = ddFor('Window');
  assert.equal((await window.innerText()).replace(/\s+/g, ' ').trim(), '1 to 15 Oct 2026');
  assert.deepEqual(await window.locator('time').evaluateAll((els) => els.map((el) => el.getAttribute('datetime'))), ['2026-10-01', '2026-10-15']);
  const height = await window.evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(height < 40, `The window wraps: its value is ${height}px tall`);
  await context.close();
}

async function proseParagraphs({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'prose-gaps', { viewport: { width: 1440, height: 900 } });
  await openResponses(page);
  const prose = await page.evaluate(() => [...document.querySelectorAll('#stage .compare__prose')].map((box) => {
    const ps = [...box.querySelectorAll('p')];
    return {
      empty: ps.filter((p) => !p.textContent.replace(/ /g, ' ').trim()).length,
      gaps: ps.slice(1).map((p, i) => Math.round(p.getBoundingClientRect().top - ps[i].getBoundingClientRect().bottom)),
      para: ps.map((p) => p.classList.contains('compare__line--para')),
    };
  }));
  assert.ok(prose.length >= 2, 'The example comparison has no prose to measure');
  for (const side of prose) {
    assert.equal(side.empty, 0, 'A comparison renders an empty paragraph for a blank line');
    side.gaps.forEach((gap, i) => {
      const want = side.para[i + 1] ? 17 : 9;
      assert.ok(Math.abs(gap - want) <= 2, `A gap between comparison paragraphs is ${gap}px, not about ${want}px`);
    });
  }
  await context.close();
}
