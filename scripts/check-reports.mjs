/**
 * Browser regressions for the Reports view's reading surface, run by
 * scripts/check-workspace.mjs: the current page tab stays in sight, the rail
 * fits beside a short report without a band of desk and never scrolls
 * sideways, the rail's filter, closed disclosures on paper, and the longest
 * line at every Line width. Each check opens its own browser context, so it
 * leaves nothing in the shared localhost profile.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const COMPLETE = fileURLToPath(new URL('../fixtures/complete.json', import.meta.url));

/** English with the letter mix that first ran past the measure. */
const LONG = 'At 14:02 UTC the cart-api 4.18 deploy began rolling out across every region. The release lowered the database connection pool from 50 to 12 connections per instance, a value copied from a staging profile that nobody had reviewed since the spring. Under the afternoon peak the pool ran out within two minutes, and requests queued for a connection instead of failing fast, so the checkout service kept waiting on a database that had already said no to it many times over the same quarter hour.';

/** A short report whose one heading is far wider than the rail. */
const LONG_HEADING = 'A heading far longer than the rail is wide, which has to end in an ellipsis and show the rest on hover';
const SHORT_REPORT = {
  dossier: {
    version: 1,
    title: 'Short report beside the rail',
    pages: [{ title: 'One', blocks: [{ type: 'heading', text: LONG_HEADING }, { type: 'prose', text: 'Two lines of text.' }] }],
  },
};

export async function checkReports({ browser, base, errors }) {
  await tabsStayInView({ browser, base, errors });
  await railBesideShortReport({ browser, base, errors });
  await disclosuresPrintOpen({ browser, base, errors });
  await lineLengthAtEveryWidth({ browser, base, errors });
}

async function fresh(browser, base, errors, label, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  await page.goto(`${base}/?check=${label}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  return { context, page };
}

/** Open from the Open dialog, through the kit's phone menu when it is there. */
async function openReport(page, { file, text, title }) {
  const menu = page.locator('.header-overflow-toggle');
  if (await menu.isVisible() && (await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.locator('#openReport').click();
  if (file) {
    await page.locator('#importFile').setInputFiles(file);
    await page.waitForFunction(() => (document.getElementById('importDetected')?.textContent || '').length > 0);
  } else {
    await page.locator('#importText').fill(text);
  }
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.locator('#stage .report-title').filter({ hasText: title }).waitFor();
}

/** Where the current tab sits in its row, against the row's unfaded part. */
function tabPlace(page) {
  return page.evaluate(() => {
    const row = document.querySelector('#stage .report-tabs');
    const tab = row.querySelector('.report-tab[aria-current="page"]');
    const style = getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    return {
      name: tab.textContent,
      inView: rect.left >= box.left + parseFloat(style.paddingLeft) - 1
        && rect.right <= box.left + row.clientWidth - parseFloat(style.paddingRight) + 1,
      scrolls: row.scrollWidth > row.clientWidth,
      scrollLeft: row.scrollLeft,
    };
  });
}

/** Wait until the row has stopped moving (a smooth scroll runs for a few frames). */
async function rowSettled(page) {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => document.querySelector('#stage .report-tabs').scrollLeft);
    if (now === last) return;
    last = now;
    await page.waitForTimeout(50);
  }
}

async function stepTo(page, key, from) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(key);
  await page.waitForFunction((from) => {
    const tab = document.querySelector('#stage .report-tab[aria-current="page"]');
    return tab && tab.textContent !== from;
  }, from);
}

/**
 * The tab row is rebuilt on each page change and used to start at its
 * beginning, so on a narrow sheet the current tab was under the fade or past
 * it. It now scrolls the current tab into the unfaded part, never the page.
 */
async function tabsStayInView({ browser, base, errors }) {
  for (const { width, reducedMotion } of [{ width: 390, reducedMotion: 'reduce' }, { width: 1024, reducedMotion: 'no-preference' }]) {
    const { context, page } = await fresh(browser, base, errors, `tabs-${width}`, { viewport: { width, height: 844 }, reducedMotion });
    await openReport(page, { file: COMPLETE, title: 'Rate limiter fix' });
    const count = await page.locator('#stage .report-tab').count();
    assert.ok(count >= 7, `The tab check needs a long row, found ${count} tabs`);
    let place = await tabPlace(page);
    assert.ok(place.scrolls, `${width}px: the tab row fits, so this check proves nothing`);
    const visited = [place.name];
    for (const key of [...Array(count - 1).fill(']'), ...Array(count - 1).fill('[')]) {
      // The page keeps its place: only the row scrolls.
      await page.evaluate(() => window.scrollTo(0, 60));
      const before = await page.evaluate(() => scrollY);
      await stepTo(page, key, place.name);
      // Under reduced motion the row is already there; otherwise it glides.
      if (reducedMotion !== 'reduce') await rowSettled(page);
      place = await tabPlace(page);
      visited.push(place.name);
      assert.ok(place.inView, `${width}px: after ${key} the current tab "${place.name}" is not wholly in view (row at ${place.scrollLeft})`);
      const after = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
      if (after.max >= before) assert.equal(after.y, before, `${width}px: changing page moved the window`);
    }
    assert.equal(new Set(visited).size, count, `${width}px: [ and ] did not visit every page`);
    await context.close();
  }
}

/**
 * The docked rail beside a short report: no band of desk between the report
 * bar and the sheet, an outline that ellipsizes instead of widening the rail,
 * and the filter of design 7.2.3.
 */
async function railBesideShortReport({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'rail', { viewport: { width: 1440, height: 1000 } });
  // The theme-color is the bar's middle stop, as index.html says.
  const colours = await page.evaluate(() => ({
    meta: document.querySelector('meta[name="theme-color"]').content.toLowerCase(),
    mid: getComputedStyle(document.querySelector('.header-bar')).getPropertyValue('--header-bg-mid').trim().toLowerCase(),
  }));
  assert.equal(colours.meta, colours.mid, 'theme-color is not the header bar\'s middle stop');

  await openReport(page, { text: JSON.stringify(SHORT_REPORT), title: 'Short report beside the rail' });
  assert.equal(await page.locator('html').getAttribute('data-dossier-rail'), 'open');
  const band = () => page.evaluate(() => Math.round(document.querySelector('#stage .report-shell').getBoundingClientRect().top
    - document.getElementById('reportBar').getBoundingClientRect().bottom));
  assert.ok(await band() <= 24, `A short report sits ${await band()}px under the report bar with the rail open`);
  await page.locator('#toggleFindings').click();
  assert.ok(await band() <= 24, `With Check report open the sheet sits ${await band()}px under the report bar`);
  await page.locator('#toggleFindings').click();

  // The rail never scrolls sideways; the long heading ellipsizes and its
  // full text comes back as a title on hover.
  const rail = await page.evaluate(() => {
    const el = document.getElementById('rail');
    return { width: el.clientWidth, content: el.scrollWidth };
  });
  assert.ok(rail.content <= rail.width + 1, `The rail scrolls sideways: ${rail.content}px of content in ${rail.width}px`);
  const long = page.locator('#outline a', { hasText: 'A heading far longer' });
  const cut = await long.evaluate((a) => ({ cut: a.scrollWidth > a.clientWidth, overflow: getComputedStyle(a).textOverflow }));
  assert.deepEqual(cut, { cut: true, overflow: 'ellipsis' }, 'The long outline link does not ellipsize');
  await long.hover();
  assert.equal(await long.getAttribute('title'), LONG_HEADING, 'A cut outline link has no title with its full text');
  const short = page.locator('#outline a', { hasText: /^One$/ });
  await short.hover();
  assert.equal(await short.getAttribute('title'), null, 'An outline link that fits got a title');

  // The filter: a search mark inside on the left, the key hint inside on the
  // right, New as a secondary button beside it, and an icon button to hide.
  const parts = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
    const newButton = document.querySelector('[data-action="new-report"]');
    const hide = document.querySelector('#rail [data-action="toggle-rail"]');
    return {
      field: r('#reportFilter'), icon: r('.ds-rail__search'), key: r('#reportFilterKey'), newBox: r('[data-action="new-report"]'),
      keyText: document.getElementById('reportFilterKey').textContent,
      placeholder: document.getElementById('reportFilter').placeholder,
      // What is on screen: the words for assistive technology are hidden.
      newText: newButton.textContent.replace(newButton.querySelector('.visually-hidden')?.textContent || '', '').trim(),
      newQuiet: newButton.classList.contains('btn--quiet'),
      newBorder: getComputedStyle(newButton).borderTopColor,
      hideText: hide.innerText.trim(),
      hideSvg: Boolean(hide.querySelector('svg')),
      hideBox: hide.getBoundingClientRect().toJSON(),
    };
  });
  assert.ok(parts.icon.left >= parts.field.left && parts.icon.left - parts.field.left <= 14 && parts.icon.right < parts.field.left + 32, 'The search mark is not inside the field on the left');
  assert.ok(parts.icon.top >= parts.field.top && parts.icon.bottom <= parts.field.bottom, 'The search mark is not inside the field');
  assert.ok(parts.key.right <= parts.field.right && parts.field.right - parts.key.right <= 10, 'The key hint is not inside the field on the right');
  assert.equal(parts.keyText, '/');
  assert.equal(parts.placeholder, 'Filter');
  assert.equal(parts.newText, 'New');
  assert.equal(parts.newQuiet, false, 'New is a quiet button, not a secondary one');
  assert.notEqual(parts.newBorder, 'rgba(0, 0, 0, 0)', 'New has no border, so it does not read as a secondary button');
  assert.ok(Math.abs(parts.newBox.top - parts.field.top) < 2 && parts.newBox.left > parts.field.right, 'New is not beside the filter');
  assert.equal(parts.newBox.height, parts.field.height, 'New and the filter differ in height');
  assert.equal(await page.getByRole('button', { name: 'New report', exact: true }).count(), 1, 'New does not say what it makes');
  assert.equal(parts.hideText, '', 'The hide control shows text');
  assert.ok(parts.hideSvg && Math.round(parts.hideBox.width) === Math.round(parts.hideBox.height), 'The hide control is not a square icon button');
  assert.equal(await page.getByRole('button', { name: 'Hide saved reports', exact: true }).count(), 1);
  // The hint steps aside while the field has focus or text.
  const key = page.locator('#reportFilterKey');
  await page.locator('#reportFilter').focus();
  assert.equal(await key.isVisible(), false, 'The key hint stays over a focused field');
  await page.locator('#reportFilter').fill('zzz');
  await page.locator('#reportFilter').blur();
  assert.equal(await key.isVisible(), false, 'The key hint sits over typed text');
  await page.locator('#reportFilter').fill('');
  await page.locator('#reportFilter').blur();
  assert.equal(await key.isVisible(), true, 'The key hint did not come back on an empty, unfocused field');
  // It names the key that works now: a remap moves it, turning shortcuts
  // off removes it.
  await page.evaluate(() => window.NeoKeys.remap('site:/', 'f'));
  assert.equal(await key.innerText(), 'f', 'The key hint did not follow a remap');
  assert.equal(await page.locator('#reportFilter').getAttribute('aria-keyshortcuts'), 'f');
  await page.evaluate(() => window.NeoKeys.setDisabled(true));
  assert.equal(await key.isVisible(), false, 'The key hint stays with shortcuts off');
  assert.equal(await page.locator('#reportFilter').getAttribute('aria-keyshortcuts'), null);
  await page.evaluate(() => { window.NeoKeys.setDisabled(false); window.NeoKeys.resetRemaps(); });
  assert.equal(await key.innerText(), '/');
  await context.close();
}

/** Closed disclosures print open, and the reader's own open or closed choice is back afterwards. */
async function disclosuresPrintOpen({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'print', { viewport: { width: 1440, height: 900 } });
  await openReport(page, { file: COMPLETE, title: 'Rate limiter fix' });
  await page.locator('#stage .report-tab').last().click();
  await page.locator('#stage .report-tab[aria-current="page"]').filter({ hasText: 'How this was checked' }).waitFor();
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#stage .report-shell details')].map((d) => ({
    open: d.open,
    visible: [...d.children].filter((c) => c.tagName !== 'SUMMARY').every((c) => c.checkVisibility()),
  })));
  const closed = await shown();
  assert.ok(closed.length >= 2 && closed.every((d) => !d.open && !d.visible), 'The print check needs closed disclosures');
  // The reader opened the first one; it stays open after printing.
  await page.locator('#stage .report-shell details > summary').first().click();

  // Without the stylesheet's ::details-content fallback, only the script
  // can open them: Chromium keeps a closed disclosure's content out of reach
  // of `details > *`.
  await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!(rule instanceof CSSMediaRule) || !/print/.test(rule.conditionText)) continue;
        for (let i = rule.cssRules.length - 1; i >= 0; i -= 1) {
          if (/::details-content/.test(rule.cssRules[i].selectorText || '')) rule.deleteRule(i);
        }
      }
    }
  });
  await page.emulateMedia({ media: 'print' });
  assert.ok((await shown()).slice(1).every((d) => !d.visible), 'Closed disclosures printed open with no fallback and no script, so this check proves nothing');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const printing = await shown();
  assert.ok(printing.every((d) => d.open && d.visible), 'A closed disclosure did not print open');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: null });
  const after = await shown();
  assert.equal(after[0].open, true, 'Printing closed a disclosure the reader had opened');
  assert.ok(after.slice(1).every((d) => !d.open), 'Disclosures opened for print stayed open');
  await context.close();

  // The stylesheet fallback on its own, for a print no script sees (the
  // one-file export): every disclosure's content is on paper.
  const fallback = await fresh(browser, base, errors, 'print-css', { viewport: { width: 1440, height: 900 } });
  await openReport(fallback.page, { file: COMPLETE, title: 'Rate limiter fix' });
  await fallback.page.locator('#stage .report-tab').last().click();
  await fallback.page.locator('#stage .report-tab[aria-current="page"]').filter({ hasText: 'How this was checked' }).waitFor();
  await fallback.page.emulateMedia({ media: 'print' });
  const css = await fallback.page.evaluate(() => [...document.querySelectorAll('#stage .report-shell details')]
    .every((d) => !d.open && [...d.children].filter((c) => c.tagName !== 'SUMMARY').every((c) => c.checkVisibility())));
  assert.equal(css, true, 'The print stylesheet does not open a closed disclosure on its own');
  await fallback.context.close();
}

/**
 * Known worst cases: ordinary English with runs of narrow letters (i, l, t, f,
 * spaces, quotes, parentheses), which fit more characters into a line than the
 * measure's average advance. With the sheet's measure 2 percent short at Line
 * width Wide, the first three set lines of 76 and 77 characters. The last two
 * are real paragraphs, a test report's and a README's, that independent
 * review found still setting 76 and 75 with it 6 percent short.
 */
const SAMPLES = Object.freeze([
  'If the limiter keeps its counters in each process, a client that spreads its requests across the pool gets the full limit from every instance, which multiplies the allowance by the number of processes running at the time.',
  'Two of the four workers restarted during the window, and each restart reset its counter, so for a few seconds the service let through more traffic than the limit allows.',
  'It is not a fix if it only works on my machine, and it is not finished until the test that failed in the pipeline passes there as well, without a retry and without a skip.',
  LONG,
  'If this were a tool we meant to keep for years it would be a closer call. It is not, and the decision has to be made before the release, so the simple fix wins for now.',
  'We kept the limit per tenant, not per user, because it is the tenant that pays for the capacity and it is the tenant that gets the alert when it runs out.',
  'C11.1 requires visible, non-removable provenance naming the origin and the issuing handle. On a maximum-length handle this control names neither correctly, and the brief\'s section 5 treats provenance as a hard constraint on the design rather than a nicety. The verify URL line below it is intact, so the credential is still verifiable, which is the mitigation and the reason this is a fix rather than a stop-everything.',
  'Switch to the Brief tab in the right panel. The brief assembles all blocks in a structured hierarchy, appends the connection graph, flags any remaining gaps, and applies any prompt options you set (tone, detail level, acceptance criteria, security, TypeScript, etc.). It reads as a document, with a section outline and an estimate of its size.',
]);

/**
 * The bundled reports' own prose: every string of 140 characters or more in
 * reports/*.json that is one paragraph of plain text (no line breaks, braces,
 * angle brackets or table pipes). Read from disk, so a report added later is
 * measured too.
 */
async function bundledProse() {
  const dir = new URL('../reports/', import.meta.url);
  const found = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      if (value.length >= 140 && !/[\n{}<>|]/.test(value)) found.push(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    walk(JSON.parse(await fs.readFile(new URL(name, dir), 'utf8')));
  }
  return found;
}

/** One page of every block whose text is held to a measure; the check fills each with every sample. */
const HELD = 'Placeholder text that the check replaces with each sample.';
const MEASURE_REPORT = {
  dossier: {
    version: 1,
    title: 'Line length at every width',
    pages: [{
      title: 'Reading text',
      blocks: [
        { type: 'prose', text: HELD },
        { type: 'callout', tone: 'warn', text: HELD },
        { type: 'quote', text: HELD, who: 'On-call rotation' },
        { type: 'risks', items: [{ title: 'A risk', severity: 'medium', likelihood: 'possible', mitigation: HELD }] },
        { type: 'timeline', items: [{ at: '2026-10-01 09:14', label: HELD, tone: 'info' }, { at: '2026-10-01 11:40', label: 'Done', tone: 'good' }] },
        { type: 'checklist', items: [{ label: HELD, state: 'skipped', note: HELD }] },
        { type: 'compare', kind: 'text', mode: 'toggle', prompt: HELD, left: { label: 'A', value: HELD }, right: { label: 'B', value: `${HELD} B` }, note: HELD },
      ],
    }],
  },
};

/** Roman, italic and UI-face text, each element with its own text node to fill. */
const HELD_TEXT = Object.freeze(['.block-prose', '.block-callout', '.block-quote p', '.risk-mitigation', '.timeline-label',
  '.block-checklist li', '.check-note', '.compare__prompt p', '.compare__prose', '.block-note']);

/**
 * For each selector, the longest full line any sample sets in it, as its
 * character count and its text. A sample goes into the element's first text
 * past a bold lead-in and a visually hidden label; a line is counted without
 * its trailing space and without hidden text, and the last line of each
 * element is not full.
 */
function longestLines(page, samples) {
  return page.evaluate(([selectors, samples]) => {
    const hidden = '.visually-hidden, .sr-only';
    const longest = (el) => {
      const lines = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest(hidden)) continue;
        for (let i = 0; i < node.data.length; i += 1) {
          range.setStart(node, i); range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect || !rect.width) continue;
          const mid = (rect.top + rect.bottom) / 2;
          let line = lines.find((l) => mid > l.top && mid < l.bottom);
          if (!line) { line = { top: rect.top, bottom: rect.bottom, text: '' }; lines.push(line); }
          line.text += node.data[i];
        }
      }
      lines.sort((a, b) => a.top - b.top);
      return lines.slice(0, -1).map((l) => l.text.trim())
        .reduce((best, text) => (text.length > best.n ? { n: text.length, line: text } : best), { n: 0, line: '' });
    };
    const out = {};
    for (const selector of selectors) {
      const el = [...document.querySelectorAll(`#stage ${selector}`)].find((e) => e.getClientRects().length);
      const walker = el && document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while (walker && (node = walker.nextNode())) {
        if (!node.parentElement.closest(`strong:first-child, ${hidden}`) && node.data.trim().length > 3) break;
      }
      if (!node) { out[selector] = { n: 0, line: '' }; continue; }
      const original = node.data;
      out[selector] = samples.map((sample) => { node.data = sample; return longest(el); })
        .reduce((best, found) => (found.n > best.n ? found : best));
      node.data = original;
    }
    return out;
  }, [HELD_TEXT, samples]);
}

async function chooseDisplay(page, name, value) {
  await page.locator('#displayOptions').click();
  await page.locator(`#displayDialog input[name="${name}"][value="${value}"]`).check();
  await page.locator('#displayDialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Every held element, at every Line width, in both faces, filled in turn with
 * the known worst cases (SAMPLES) and the bundled reports' prose. It fails on
 * a full line past 73 characters, two inside 75, and when the three options
 * stop being apart. The sample set is small and chosen, so passing here is
 * not a bound for arbitrary text; css/report.css records what the sheet's
 * measure holds over a corpus of 3,710 paragraphs. The worst cases are what
 * caught each earlier setting at Wide: the compare block's prompt set 76 on
 * the root's measure, plain English 76 with the sheet's measure 2 percent
 * short, and a real paragraph 76 with it 6 percent short.
 */
async function lineLengthAtEveryWidth({ browser, base, errors }) {
  const samples = [...SAMPLES, ...await bundledProse()];
  assert.ok(samples.length >= SAMPLES.length + 20, `The bundled reports gave only ${samples.length - SAMPLES.length} paragraphs to measure`);
  const { context, page } = await fresh(browser, base, errors, 'measure', { viewport: { width: 1440, height: 900 } });
  await openReport(page, { text: JSON.stringify(MEASURE_REPORT), title: 'Line length at every width' });
  const seen = {};
  const lines = {};
  for (const measure of ['narrow', 'normal', 'wide']) {
    await chooseDisplay(page, 'measure', measure);
    for (const face of ['serif', 'sans']) {
      await chooseDisplay(page, 'typeface', face);
      for (const [selector, { n, line }] of Object.entries(await longestLines(page, samples))) {
        seen[`${measure} ${face} ${selector}`] = n;
        lines[`${measure} ${face} ${selector}`] = line;
      }
    }
  }
  const short = Object.entries(seen).filter(([, n]) => n < 30);
  assert.deepEqual(short, [], `The line length check found no full line to measure: ${JSON.stringify(seen)}`);
  const over = Object.entries(seen).filter(([, n]) => n > 73).map(([key, n]) => `${key}: ${n} "${lines[key]}"`);
  assert.ok(!over.length, `Lines run past 73 characters:\n${over.join('\n')}`);
  for (const face of ['serif', 'sans']) {
    const top = (measure) => Math.max(...Object.entries(seen).filter(([k]) => k.startsWith(`${measure} ${face} `)).map(([, n]) => n));
    assert.ok(top('narrow') < top('normal') && top('normal') < top('wide'), `${face}: Narrow, Normal and Wide set lines of ${top('narrow')}, ${top('normal')} and ${top('wide')}`);
    assert.ok(top('wide') >= 68, `${face}: Wide tops out at ${top('wide')} characters, too short to be Wide`);
  }
  await context.close();
}
