/**
 * Browser checks for untrusted HTML in the Compare view and the Reports
 * view: a hostile report that must not run, reach this page, navigate
 * anything or leave localhost, in every render mode; SVG links (an
 * `xlink:href`, an address an animation writes, a link an SVG `<use>`
 * draws), links in declarative shadow roots, middle clicks and modifier
 * clicks; the guard that stops any other navigation
 * of a frame before it starts, and the backstop that puts a frame back on
 * its report when the browser takes it away anyway, in a compare column, in
 * the Reports view and in the one-file export's fitter; and what Dossier
 * format keeps of a page styled by its own CSS.
 *
 * Run by scripts/check-compare.mjs, or on its own against the dev server:
 * `node scripts/check-compare-hostile.mjs` (DOSSIER_URL overrides
 * http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { base, file, chooseFile } from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
const hostileHtml = await fs.readFile(file('fixtures/compare/hostile.html'), 'utf8');

/**
 * Document named properties shadow both the DOM members this page calls on a
 * static frame's document and any expando set on it, so one
 * `<img name="__dossierLinks">` used to turn a frame's link handling off (its
 * in-page links reloaded the report and its web links stayed in the frame),
 * and `<img name="querySelectorAll">` took the column's outline and sync.
 */
const NAMED = '<!doctype html><html><head><title>Named elements</title></head><body>'
  + '<h1>Named elements</h1>'
  + '<img name="__dossierLinks" alt=""><img name="addEventListener" alt=""><img name="querySelectorAll" alt="">'
  + '<form name="baseURI"></form><img name="ok" id="getElementById" alt=""><img name="hero" id="hero" alt="">'
  + '<p><a id="toSec" href="#sec2">Down to the second section</a></p>'
  + '<p><a id="web" href="https://example.test/named">A web link</a></p>'
  + '<div style="height: 2400px"></div><h2 id="sec2">Second section</h2><p>The end.</p></body></html>';

async function namedElementsCheck() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(`named elements: ${error.message}`));
  await ctx.route('https://example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>web</p>' }));
  try {
    await page.goto(`${base}/?check=named${Date.now()}#/~compare`, { waitUntil: 'networkidle' });
    await page.bringToFront();
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => { window.__opened.push(String(url)); return null; };
    });
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#cmp-col-k1 [data-action="cmp-choose-file"]').click(),
    ]);
    await chooser.setFiles({ name: 'named.html', mimeType: 'text/html', buffer: Buffer.from(NAMED) });
    await page.locator('#cmp-col-k1 .col__scroll').waitFor();
    await page.locator('#cmp-col-k1 .col__menu').click();
    await page.locator('#cmpColumnMenu [data-value="original"]').click();
    const frameEl = page.locator('#cmp-col-k1 .col__frame');
    await frameEl.waitFor();
    await page.frameLocator('#cmp-col-k1 .col__frame').locator('#sec2').waitFor();
    await page.waitForTimeout(300);
    const names = await frameEl.evaluate((f) => [...Document.prototype.querySelectorAll.call(f.contentDocument, 'img, form')]
      .map((el) => `${el.localName}:${el.getAttribute('name')}`));
    assert.deepEqual(names, ['img:null', 'img:null', 'img:null', 'form:null', 'img:null', 'img:hero'],
      'The static copy kept a name that shadows its document, or dropped one that does not');
    let navigated = 0;
    page.on('framenavigated', (f) => { if (f !== page.mainFrame()) navigated += 1; });
    const entries = await page.evaluate(() => history.length);
    const inFrame = page.frameLocator('#cmp-col-k1 .col__frame');
    await inFrame.locator('#toSec').click();
    await page.waitForTimeout(300);
    const after = await frameEl.evaluate((f) => ({ at: f.contentWindow.location.href, y: f.contentWindow.scrollY }));
    assert.equal(after.at, 'about:srcdoc', 'An in-page link took a named-element report away from its frame');
    assert.ok(after.y > 0, `An in-page link did not scroll a named-element report (scrollY ${after.y})`);
    await inFrame.locator('#web').click();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => window.__opened), ['https://example.test/named'], 'A web link in a named-element report did not open in a new tab');
    assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A web link navigated a named-element report');
    assert.equal(navigated, 0, 'A link navigated the frame of a named-element report');
    assert.equal(await page.evaluate(() => history.length), entries, 'A link in a named-element report made a history entry');
    const synced = await page.evaluate(async () => {
      const { compare } = await import('/js/compare/index.js');
      return { registered: compare.sync.has('k1'), headings: compare.ui.records.get('k1')?.headings?.length || 0 };
    });
    assert.deepEqual(synced, { registered: true, headings: 2 }, 'A named-element report lost its outline or its sync');
  } finally {
    await page.evaluate(() => { indexedDB.deleteDatabase('dossier-compare'); indexedDB.deleteDatabase('dossier'); localStorage.clear(); }).catch(() => {});
    await ctx.close();
  }
}

try {
  const hostile = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const hp = await hostile.newPage();
  // The report's own scripts fail on purpose here (blocked loads, a sealed
  // frame refused access to this page): those messages are the proof, not
  // errors. Anything else this page raises still fails the run.
  hp.on('pageerror', (error) => {
    if (!/Blocked a frame with origin "null"|cross-origin frame/.test(error.message)) errors.push(`hostile: ${error.message}`);
  });
  // In Dossier format and Original nothing of the report is even attempted:
  // the static copy leaves out its scripts, base, frames and outside loads,
  // so the browser has nothing to refuse and logs nothing. Interactive runs
  // the report's scripts, whose failures are the proof, so it is not counted.
  const refusals = [];
  let countRefusals = true;
  hp.on('console', (msg) => { if (countRefusals && msg.type() === 'error') refusals.push(msg.text()); });
  // A request the frame's policy refuses is reported by the browser, then
  // fails with "csp" before anything is sent. Only the others left.
  const outside = new Map();
  let watching = false;
  const isOutside = (raw) => {
    const url = new URL(raw);
    return !['127.0.0.1', 'localhost'].includes(url.hostname) && /^https?:$/.test(url.protocol);
  };
  hostile.on('request', (req) => { if (watching && isOutside(req.url())) outside.set(req, req.url()); });
  hostile.on('requestfailed', (req) => { if (/csp/i.test(req.failure()?.errorText || '')) outside.delete(req); });
  hostile.on('page', (popup) => outside.set(popup, `popup ${popup.url()}`));
  await hp.goto(`${base}/?check=hostile#/~compare`, { waitUntil: 'networkidle' });
  watching = true;
  await hp.evaluate(() => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(String(url)); return null; };
  });
  await chooseFile(hp, 'k1', 'fixtures/compare/hostile.html');
  await hp.waitForTimeout(400);
  const reader = hp.locator('#cmp-col-k1 .reader');
  assert.match(await reader.innerText(), /A reader should see these words/);
  assert.equal(await reader.getByText('Hidden paragraph').count(), 0);
  assert.equal(await reader.getByText('Invisible paragraph').count(), 0);
  const formatMarkup = await reader.innerHTML();
  // Words like "javascript:" may be shown as text; no tag may carry them.
  const tags = formatMarkup.match(/<[^>]+>/g) || [];
  const liveTags = tags.filter((tag) => /^<(script|iframe|form|input|button|object|embed|base|meta|link|style)\b|\son[a-z]+=|(href|src)="\s*(javascript|data:text|vbscript)/i.test(tag));
  assert.deepEqual(liveTags, [], 'Dossier format kept something live');
  assert.ok(!/example\.invalid\/pixel/.test(formatMarkup), 'A remote image reached an img');
  assert.match(formatMarkup, /Remote image from example\.invalid not loaded/);

  async function hostileClean(label) {
    const state = await hp.evaluate(() => ({
      pwned: window.__dossierPwned || null,
      stored: localStorage.getItem('dossier-pwned'),
      bothTokens: [...document.querySelectorAll('iframe')].filter((f) => {
        const tokens = (f.getAttribute('sandbox') || '').split(/\s+/);
        return tokens.includes('allow-scripts') && tokens.includes('allow-same-origin');
      }).length,
      unsandboxed: [...document.querySelectorAll('#compareView iframe, #stage iframe')].filter((f) => !f.hasAttribute('sandbox')).length,
    }));
    assert.equal(state.pwned, null, `${label}: a script in the report ran (${state.pwned})`);
    assert.equal(state.stored, null, `${label}: the report wrote to this page's storage`);
    assert.equal(state.bothTokens, 0, `${label}: a frame has allow-scripts and allow-same-origin`);
    assert.equal(state.unsandboxed, 0, `${label}: a frame has no sandbox`);
  }
  await hostileClean('Dossier format');

  // ── Original: a static frame. Links are caught, nothing navigates ─────────
  await hp.locator('#cmp-col-k1 .col__menu').click();
  await hp.locator('#cmpColumnMenu [data-value="original"]').click();
  const frameEl = hp.locator('#cmp-col-k1 .col__frame');
  await frameEl.waitFor();
  await hp.waitForTimeout(500);
  assert.equal(await frameEl.getAttribute('sandbox'), 'allow-same-origin');
  // Worded as the Reports view words it: the frame counts the whole page.
  assert.match(await hp.locator('#cmp-col-k1 .col__notes').innerText(), /^Across the whole page and its styles, .* not loaded\./);
  // The frame was handed a copy with no handler, refresh, script address,
  // animated link address or outside load left, even the ones that only show
  // up when the copy is parsed again, or inside a template the frame builds
  // a shadow root from: read in the frame's document with its shadow roots
  // (both open: the copy builds a closed one open, so its links are caught
  // like any other), and in the copy itself with every template's content.
  const copy = await frameEl.evaluate((f) => {
    const live = (root) => [...root.querySelectorAll('*')].flatMap((el) => [el, ...(el.shadowRoot ? live(el.shadowRoot) : [])]);
    const handed = (root) => [...root.querySelectorAll('*')].flatMap((el) => [el, ...(el.localName === 'template' ? handed(el.content) : [])]);
    const count = (els) => ({
      handlers: els.filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length,
      refresh: els.filter((el) => el.localName === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')).length,
      scriptLinks: els.filter((el) => /^\s*javascript:/i.test(el.getAttribute('href') || '')).length,
      hrefAnimations: els.filter((el) => /^(animate|set|animatetransform)$/i.test(el.localName)
        && /^(xlink:)?href$/i.test(el.getAttribute('attributeName') || '')).length,
      loads: els.filter((el) => /^(img|image|source|video|audio)$/i.test(el.localName)
        && ['src', 'srcset', 'href'].some((name) => el.hasAttribute(name) && !/^\s*(data:|blob:|#)/i.test(el.getAttribute(name)))).length,
    });
    const doc = f.contentDocument;
    const source = new DOMParser().parseFromString(f.getAttribute('srcdoc'), 'text/html');
    return {
      frame: count(live(doc)),
      shadowRoots: live(doc).filter((el) => el.shadowRoot).length,
      copy: count(handed(source)),
      templates: handed(source).filter((el) => el.localName === 'template').length,
      overscroll: getComputedStyle(doc.documentElement).overscrollBehaviorY,
    };
  });
  const none = { handlers: 0, refresh: 0, scriptLinks: 0, hrefAnimations: 0, loads: 0 };
  assert.deepEqual(copy, {
    frame: none, shadowRoots: 2, copy: none, templates: 2, overscroll: 'contain',
  }, 'The static copy kept something live, or its scroll runs on into the page');
  const frame = hp.frameLocator('#cmp-col-k1 .col__frame');
  const pageUrl = hp.url();
  const said = () => hp.locator('#app-toast').innerText();
  for (const id of ['jsLink', 'dataLink', 'topLink', 'relLink', 'localLink', 'svgXlink', 'svgSet', 'svgAnimate']) {
    await frame.locator(`#${id}`).click();
    await hp.waitForTimeout(100);
    // A refused scheme is not "a file beside the report", and is not repeated.
    if (id === 'dataLink') assert.equal(await said(), 'That link was not opened: Dossier only opens web and mail links.');
    if (id === 'relLink') assert.match(await said(), /^That link points at other-report\.html, a file beside the report/);
  }
  // A middle click opens a web link in a new tab, as a click does; one on a
  // link that goes nowhere still goes nowhere.
  await frame.locator('#topLink').click({ button: 'middle' });
  await frame.locator('#svgXlink').click({ button: 'middle' });
  await frame.locator('#jsLink').click({ button: 'middle' });
  await frame.locator('#hostileSubmit').click();
  await frame.locator('p', { hasText: 'Hover over this paragraph' }).hover();
  await hp.waitForTimeout(300);
  assert.equal(hp.url(), pageUrl, 'A link in the report navigated the page');
  assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A link navigated the frame');
  assert.deepEqual(await hp.evaluate(() => window.__opened), [
    'https://example.invalid/top', 'https://example.invalid/svg-xlink',
    'https://example.invalid/top', 'https://example.invalid/svg-xlink',
  ], 'Only the web links open, in a new tab, on a click and on a middle click');
  // Links in declarative shadow roots are found on the click's composed path
  // (a middle click too, which no navigation guard sees), a closed root's
  // as well, since the copy builds it open. The one an animation addressed
  // has no address left.
  await frame.locator('#shadowLink').click();
  await frame.locator('#shadowJs').click();
  await frame.locator('#shadowSet').click();
  await frame.locator('#shadowClosed').click();
  await frame.locator('#shadowLink').click({ button: 'middle' });
  await hp.waitForTimeout(200);
  assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A shadow root link navigated the frame');
  assert.deepEqual((await hp.evaluate(() => window.__opened)).slice(4), [
    'https://example.invalid/shadow-open', 'https://example.invalid/shadow-closed', 'https://example.invalid/shadow-open',
  ], 'A shadow root link did not open in a new tab (on a click and a middle click), or one with no web address did');
  // Links an SVG <use> draws are out of every listener's sight. A click
  // reaches the navigation guard with the address already resolved against
  // this page's own, and the guard takes it back to the report's terms: a
  // web link opens in a new tab, a relative one is a file beside the report
  // (not Dossier itself in a new tab), and an in-page one scrolls the frame.
  // A middle click or a modifier click there opens nothing at all, while on
  // the closed root's link, built open, it opens the link as a click does.
  const openedBefore = (await hp.evaluate(() => window.__opened)).length;
  await hp.evaluate(() => { document.getElementById('app-toast').textContent = ''; });
  await frame.locator('#useWeb').click();
  await frame.locator('#useFile').click();
  await hp.waitForTimeout(100);
  assert.match(await said(), /^That link points at other-use\.html, a file beside the report/, 'A use link to a file beside the report was not refused as one');
  await frameEl.evaluate((f) => f.contentWindow.scrollTo(0, 0));
  await frame.locator('#usePlace').click();
  await hp.waitForTimeout(100);
  // Scrolled until the place is at the top, or as far as the frame goes.
  const usePlace = await frameEl.evaluate((f) => ({
    y: f.contentWindow.scrollY,
    end: f.contentDocument.scrollingElement.scrollHeight - f.contentWindow.innerHeight,
    top: Math.round(f.contentDocument.getElementById('forms').getBoundingClientRect().top),
  }));
  assert.ok(usePlace.y > 0 && (Math.abs(usePlace.top) <= 24 || usePlace.y >= usePlace.end - 1), `A use link to a place in the report left that place at ${usePlace.top}px in the frame, scrolled ${usePlace.y} of ${usePlace.end}px`);
  await frame.locator('#useWeb').click({ button: 'middle' });
  await frame.locator('#useWeb').click({ modifiers: ['Shift'] });
  await frame.locator('#useWeb').click({ modifiers: ['ControlOrMeta'] });
  await frame.locator('#shadowClosed').click({ button: 'middle' });
  await frame.locator('#shadowClosed').click({ modifiers: ['Shift'] });
  await hp.waitForTimeout(300);
  assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A use link navigated the frame');
  assert.equal(hostile.pages().length, 1, 'A middle click or a modifier click opened a tab or a window');
  assert.deepEqual((await hp.evaluate(() => window.__opened)).slice(openedBefore), [
    'https://example.invalid/use-web', 'https://example.invalid/shadow-closed', 'https://example.invalid/shadow-closed',
  ], 'A use link opened something other than its web address, or a closed root link missed a middle or a modifier click');
  // Taken back out, so the counts below stay those of the links they name.
  await hp.evaluate((n) => { window.__opened.length = n; }, openedBefore);
  await hostileClean('Original');

  // A navigation no link handler caught is stopped before it starts (the
  // Navigation API's navigate event): the frame keeps its report, the history
  // gets no entry, and there is nothing to report.
  const historyBefore = await hp.evaluate(() => history.length);
  await frameEl.evaluate((f) => { f.contentWindow.location.href = 'about:blank'; });
  await hp.waitForTimeout(300);
  assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A navigation took the frame away from its report');
  assert.equal(await hp.evaluate(() => history.length), historyBefore, 'A stopped navigation left a history entry');
  assert.equal(await hp.locator('#cmp-col-k1 [data-restored]').count(), 0, 'A stopped navigation was reported as a restore');

  // The backstop, for a browser without that API: a navigation this page
  // cannot stop (the browser's own, driven by Playwright) takes the frame
  // away; the report comes back, the column says so, and putting it back adds
  // no entry of its own.
  const columnChild = await (await frameEl.elementHandle()).contentFrame();
  await columnChild.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
  await hp.locator('#cmp-col-k1 .col__notes [data-restored]').waitFor();
  await hp.waitForFunction(() => {
    const f = document.querySelector('#cmp-col-k1 .col__frame');
    try { return f.contentWindow.location.href === 'about:srcdoc' && f.contentDocument.querySelector('h1')?.textContent === 'Hostile report'; } catch { return false; }
  }, null, { timeout: 3000 });
  assert.match(await hp.locator('#cmp-col-k1 [data-restored]').innerText(), /opened another page in its column, so the report was loaded again/);
  const historyRestored = await hp.evaluate(() => history.length);
  assert.ok(historyRestored <= historyBefore + 1, 'Putting the report back added a history entry');
  // Its links are caught again on the page that came back, and so is any
  // other navigation.
  await frame.locator('#svgXlink').click();
  await hp.waitForTimeout(100);
  assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A link navigated the restored frame');
  assert.equal((await hp.evaluate(() => window.__opened)).length, 8, 'The restored frame lost its link handling');
  await frameEl.evaluate((f) => { f.contentWindow.location.href = 'about:blank'; });
  await hp.waitForTimeout(300);
  assert.equal(await frameEl.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'The restored frame lost its navigation guard');
  assert.equal(await hp.evaluate(() => history.length), historyRestored, 'The restored frame let a navigation make a history entry');
  assert.deepEqual(refusals, [], 'Dossier format or Original logged errors');
  countRefusals = false;

  // ── Interactive: the sealed host, scripts run with no way out ─────────────
  await hp.locator('#cmp-col-k1 .col__menu').click();
  await hp.locator('#cmpColumnMenu [data-value="interactive"]').click();
  const live = hp.locator('#cmp-col-k1 .col__frame--interactive');
  await live.waitFor();
  await hp.waitForTimeout(800);
  assert.equal(await live.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await live.getAttribute('src'), 'embed.html');
  await hostileClean('Interactive');

  // ── Dossier format without the page's CSS ─────────────────────────────────
  // A stat tile's number and label stay two words; a word styled inside
  // running text stays one. A drawing coloured by the page's classes is
  // described (it would paint solid black), one with its own fills is drawn.
  const normalized = await hp.evaluate(async () => {
    const { htmlToIr } = await import('/js/compare/normalize.js');
    const { renderIr } = await import('/js/compare/ir-render.js');
    const html = '<main><div class="stat"><span class="num">201</span><span class="lbl">tickets this year</span></div>'
      + '<p>Up <span class="num">5</span><span class="unit">%</span> since May.</p>'
      + '<svg viewBox="0 0 10 10" role="img"><title>A styled star</title><circle class="star" cx="5" cy="5" r="4"/></svg>'
      + '<svg viewBox="0 0 10 10" aria-label="A drawn dot"><circle cx="5" cy="5" r="4" fill="#335"/></svg>'
      // Boxes the page lays out on their own get a space where two words
      // would join, and none inside a word; three or more get separators; a
      // slide footer's counter is chrome.
      + '<dl><dt>Y1</dt><dd>Upgrade plans<span class="keys">TICK-1 · TICK-2</span></dd></dl>'
      + '<p><span class="lab">Current plan<small>Rollout</small></span></p>'
      + '<ul><li><span class="n">1</span><b>Finding</b><span class="d">Scanner flags</span></li></ul>'
      + '<p>Neo<span class="accent">rgon</span> site</p>'
      + '<div class="row"><span class="l">Cache upgrades</span><span class="track"><span class="fill"></span></span><span class="v">73</span><span class="t">Themes 2, 3</span></div>'
      + '<section><footer class="slide-foot"><span class="src">One owner.</span><span class="pg">02 / 13</span></footer></section>'
      + '<p>Done <span class="frac">3 / 4</span> of the steps</p></main>';
    const out = document.createElement('div');
    out.innerHTML = renderIr(htmlToIr(html).blocks, { colId: 'zz' });
    return { text: out.textContent.replace(/\s+/g, ' '), images: [...out.querySelectorAll('img')].map((img) => img.alt) };
  });
  assert.match(normalized.text, /201 tickets this year/, 'A stat tile ran its number into its label');
  assert.match(normalized.text, /Up 5% since May/, 'A styled word in running text was split');
  assert.match(normalized.text, /A styled star\. A drawing coloured by its page/, 'A class-styled drawing was not described');
  assert.deepEqual(normalized.images, ['A drawn dot'], 'Only the drawing with its own fills is drawn');
  for (const [re, why] of [[/plans TICK-1/, 'A classed box after text was glued onto it'], [/plan Rollout/, 'An unclassed small was glued onto its text'],
    [/1 Finding Scanner flags/, 'A numbered step glued its parts'], [/Neorgon site/, 'A styled part of a word was split off'],
    [/Cache upgrades · 73 · Themes 2, 3/, 'Three boxes were not set apart'], [/One owner\./, 'A slide footer lost its note'], [/3 \/ 4/, 'A fraction outside a footer was dropped']]) assert.match(normalized.text, re, why);
  for (const [re, why] of [[/201 ·/, 'Two boxes got a separator meant for three'], [/02 \/ 13/, 'A slide footer kept its counter']]) assert.doesNotMatch(normalized.text, re, why);

  // ── The same report in the Reports view's reader ──────────────────────────
  await hp.locator('#viewReports').click();
  await hp.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  await hp.locator('#openReport').click();
  await hp.locator('#importFile').setInputFiles(file('fixtures/compare/hostile.html'));
  await hp.waitForFunction(() => /HTML/.test(document.getElementById('importDetected')?.textContent || ''));
  await hp.locator('#importDialog [data-action="import-confirm"]').click();
  const readerFrame = hp.locator('#stage iframe.block-embed--static');
  await readerFrame.waitFor();
  await hp.frameLocator('#stage iframe.block-embed--static').locator('#svgXlink').waitFor();
  const inReader = hp.frameLocator('#stage iframe.block-embed--static');
  for (const id of ['svgXlink', 'svgSet', 'svgAnimate', 'topLink', 'shadowLink', 'shadowClosed']) await inReader.locator(`#${id}`).click();
  await inReader.locator('#svgXlink').click({ button: 'middle' });
  await hp.waitForTimeout(200);
  assert.equal(await readerFrame.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A link navigated the Reports view frame');
  assert.deepEqual((await hp.evaluate(() => window.__opened)).slice(8), [
    'https://example.invalid/svg-xlink', 'https://example.invalid/top',
    'https://example.invalid/shadow-open', 'https://example.invalid/shadow-closed', 'https://example.invalid/svg-xlink',
  ], 'The Reports view reader missed an SVG link, a shadow root link or a middle click');
  // A use link to a file beside the report is refused with the reason, one
  // to a place in it scrolls the page there, and neither opens Dossier.
  await hp.evaluate(() => { document.getElementById('app-toast').textContent = ''; });
  await inReader.locator('#useFile').click();
  await hp.waitForTimeout(100);
  assert.equal(await said(), 'That link points at other-use.html, a file beside the report that Dossier does not have.', 'The Reports view did not refuse a use link to a file beside the report, naming it as Compare does');
  await hp.evaluate(() => window.scrollTo(0, 0));
  await inReader.locator('#usePlace').click();
  // The page scrolls (smoothly, unless motion is reduced) until the place is
  // under the header, or as far as the page goes.
  await hp.waitForFunction(() => {
    const y = scrollY;
    const last = window.__lastY;
    window.__lastY = y;
    return y > 0 && y === last;
  }, null, { polling: 150, timeout: 3000 }).catch(() => {});
  const readerPlace = await readerFrame.evaluate((f) => ({
    y: scrollY,
    end: document.documentElement.scrollHeight - innerHeight,
    top: Math.round(f.getBoundingClientRect().top + f.contentDocument.getElementById('forms').getBoundingClientRect().top),
  }));
  assert.ok(readerPlace.y > 0 && (readerPlace.top < 240 || readerPlace.y >= readerPlace.end - 1), `A use link to a place in the report left that place at ${readerPlace.top}px in the window, scrolled ${readerPlace.y} of ${readerPlace.end}px`);
  assert.equal((await hp.evaluate(() => window.__opened)).length, 13, 'A use link in the Reports view opened a tab');
  await hp.evaluate(() => { document.getElementById('app-toast').textContent = ''; });
  const readerHistory = await hp.evaluate(() => history.length);
  await readerFrame.evaluate((f) => { f.contentWindow.location.href = 'about:blank'; });
  await hp.waitForTimeout(300);
  assert.equal(await readerFrame.evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A navigation took the Reports view frame away');
  assert.equal(await hp.evaluate(() => history.length), readerHistory, 'A stopped navigation in the Reports view left a history entry');
  // The backstop: the frame comes back and says so in a note of its own,
  // above the holder whose outline anchors are laid over the frame, not in a
  // toast about a refused link.
  const readerChild = await (await readerFrame.elementHandle()).contentFrame();
  await readerChild.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
  await hp.locator('#stage [data-embed-restored]').waitFor();
  await hp.waitForFunction(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    try { return f.contentWindow.location.href === 'about:srcdoc' && Boolean(f.contentDocument.getElementById('svgXlink')); } catch { return false; }
  }, null, { timeout: 3000 });
  const readerNote = await hp.evaluate(() => {
    const note = document.querySelector('#stage [data-embed-restored]');
    return {
      text: note.textContent.trim(),
      role: note.getAttribute('role'),
      inHolder: Boolean(note.closest('.block-embed__frame')),
      next: note.nextElementSibling?.className || '',
    };
  });
  assert.deepEqual(readerNote, {
    text: 'Something in this report opened another page in its frame, so the report was loaded again from the top.',
    role: 'status',
    inHolder: false,
    next: 'block-embed__frame',
  }, 'The Reports view did not say that its frame was put back, or said it in the wrong place');
  assert.equal(await hp.locator('#app-toast').innerText(), '', 'The Reports view called a restore a refused link');
  await hostileClean('Reports view');

  // ── The one-file export's fitter, which handles links where frame.js is not ─
  await hp.evaluate(async (html) => {
    const { fitEmbedFrames } = await import('/js/embed-fit.js');
    const { guardFrameLinks } = await import('/js/frame-links.js');
    const { staticCopy } = await import('/js/compare/frame.js');
    const { embedDocument } = await import('/js/embed-policy.js');
    const box = document.createElement('div');
    box.id = 'fitCheck';
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin');
    f.setAttribute('data-embed-fit', '');
    f.srcdoc = embedDocument(staticCopy(html), false);
    box.append(f);
    document.body.append(box);
    await new Promise((resolve) => { f.addEventListener('load', resolve, { once: true }); });
    fitEmbedFrames(box, { links: true, guard: guardFrameLinks });
  }, hostileHtml);
  const fitted = hp.frameLocator('#fitCheck iframe');
  await fitted.locator('#svgXlink').click();
  await fitted.locator('#topLink').click({ button: 'middle' });
  await fitted.locator('#svgSet').click();
  await fitted.locator('#shadowLink').click();
  await fitted.locator('#shadowClosed').click();
  // A use link: its web address opens, a file beside the report and a place
  // in it do not open this page in a new tab, and a middle click opens nothing.
  await fitted.locator('#useWeb').click();
  await fitted.locator('#useFile').click();
  await fitted.locator('#usePlace').click();
  await fitted.locator('#useWeb').click({ button: 'middle' });
  await hp.waitForTimeout(150);
  assert.deepEqual((await hp.evaluate(() => window.__opened)).slice(13), [
    'https://example.invalid/svg-xlink', 'https://example.invalid/top',
    'https://example.invalid/shadow-open', 'https://example.invalid/shadow-closed',
    'https://example.invalid/use-web',
  ], 'The export fitter missed an SVG link, a shadow root link or a middle click, or a use link opened this page');
  assert.equal(await hp.locator('#fitCheck iframe').evaluate((f) => f.contentWindow.location.href), 'about:srcdoc', 'A use link navigated the export fitter frame');
  assert.equal(hostile.pages().length, 1, 'A middle click on a use link in the export fitter opened a tab');
  const fitHistory = await hp.evaluate(() => history.length);
  await hp.evaluate(() => { document.querySelector('#fitCheck iframe').contentWindow.location.href = 'about:blank'; });
  await hp.waitForTimeout(300);
  assert.deepEqual(await hp.evaluate(() => ({
    at: document.querySelector('#fitCheck iframe').contentWindow.location.href,
    notes: document.querySelectorAll('#fitCheck [data-embed-restored]').length,
    entries: history.length,
  })), { at: 'about:srcdoc', notes: 0, entries: fitHistory }, 'The export fitter let a navigation through');
  const fitChild = await (await hp.locator('#fitCheck iframe').elementHandle()).contentFrame();
  await fitChild.goto('about:blank', { waitUntil: 'commit' }).catch(() => {});
  await hp.locator('#fitCheck [data-embed-restored]').waitFor();
  await hp.waitForFunction(() => {
    const f = document.querySelector('#fitCheck iframe');
    try { return f.contentWindow.location.href === 'about:srcdoc' && Boolean(f.contentDocument.getElementById('svgXlink')); } catch { return false; }
  }, null, { timeout: 3000 });
  await hp.evaluate(() => document.getElementById('fitCheck').remove());

  await hp.waitForTimeout(300);
  assert.deepEqual([...outside.values()], [], 'Requests left localhost');
  await hostile.close();

  await namedElementsCheck();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: a hostile report inert in Dossier format, Original (a static copy that stays clean when parsed again, with no animated link address, its scroll contained, link refusals that say why, SVG links, links in declarative shadow roots and middle clicks opening web links in a new tab, links an SVG use draws read back as the report wrote them and never opened by a middle or modifier click, any other navigation stopped with no history entry, and a frame the browser takes away put back with a note and no entry of its own) and Interactive, stat tiles, boxes kept apart from their neighbouring words, separators between three or more boxes, slide counters left out and page-styled drawings in Dossier format, the Reports view reader catching the same links, stopping the same navigations and putting its frame back with a note above it, and the export fitter doing all three, a report that names its elements after members of its document keeping its links caught, its scroll and its sync, with no request off localhost and no console error outside Interactive.');
} finally {
  await browser.close();
}
