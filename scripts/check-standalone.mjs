/**
 * The export receipt: open the bytes we would hand someone and check them.
 *
 * The one-file export is the feature that beats the alternatives, and every
 * way it fails is invisible from the app. It rendered perfectly on screen
 * while the downloaded file carried hundreds of `var(--space-4)` references
 * with nothing defining them, because the fleet's tokens live in a
 * cross-origin stylesheet that cannot be inlined. The page still rendered,
 * just with no spacing and no type scale, and nothing reported an error.
 *
 * So this does not inspect the code that builds the file. It builds the file,
 * opens it as a separate document with the network blocked, and checks what a
 * recipient would actually see.
 *
 * Exit 0 clean, 1 findings, 2 could not run.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.DOSSIER_PORT || 8979);
const OUT = path.join(root, '.verify');

const findings = [];
const note = (msg) => findings.push(msg);

function serve() {
  const serverPath = path.join(root, '..', '..', 'scripts', 'serve.py');
  const script = fs.existsSync(serverPath) ? serverPath : null;
  const proc = script
    ? spawn('python3', [script, String(PORT), root], { stdio: 'ignore' })
    : spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
  return proc;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = serve();
  await new Promise((r) => setTimeout(r, 1200));

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.error(`  could not start a browser: ${err.message}`);
    server.kill();
    return 2;
  }

  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

    // Build the file the way the app does, and keep the bytes.
    const html = await page.evaluate(async () => {
      const doc = await (await fetch('/fixtures/complete.json')).json();
      const { parse } = await import('/js/parse.js');
      const { model } = parse(JSON.stringify(doc));
      const original = URL.createObjectURL;
      let blob = null;
      URL.createObjectURL = (b) => { blob = b; return original.call(URL, b); };
      const ex = await import('/js/export.js');
      await ex.exportStandaloneHtml(model);
      URL.createObjectURL = original;
      return blob ? blob.text() : null;
    });

    if (!html) {
      note('the export produced no file at all');
      return 1;
    }

    const file = path.join(OUT, 'receipt-standalone.html');
    fs.writeFileSync(file, html, 'utf-8');
    console.log(`  built ${(html.length / 1024).toFixed(0)} KB to ${path.relative(root, file)}`);

    // Nothing in the file may reach the network to render itself. Links the
    // report cites are a different matter and are allowed.
    const sheets = html.match(/<link[^>]*rel="stylesheet"/gi) || [];
    const scripts = html.match(/<script[^>]*src=/gi) || [];
    const imports = html.match(/@import/gi) || [];
    if (sheets.length) note(`${sheets.length} external stylesheet(s): the file is not self-contained`);
    if (scripts.length) note(`${scripts.length} external script(s): the file is not self-contained`);
    if (imports.length) note(`${imports.length} @import rule(s): the file is not self-contained`);

    // Open the bytes with the network cut, which is how a recipient opens it.
    const check = await browser.newPage();
    const blocked = [];
    await check.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`http://localhost:${PORT}/.verify/`)) return route.continue();
      blocked.push(url);
      return route.abort();
    });
    await check.goto(`http://localhost:${PORT}/.verify/receipt-standalone.html`, { waitUntil: 'load' });

    const seen = await check.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return {
        title: document.querySelector('.report-title')?.textContent || '',
        pages: document.querySelectorAll('.report-page').length,
        blocks: document.querySelectorAll('[class*="block-"]').length,
        svgs: document.querySelectorAll('svg').length,
        metrics: document.querySelectorAll('.metric-tile').length,
        evidence: document.querySelectorAll('details.evidence-marker').length,
        unresolvedVars: Array.from(document.styleSheets)
          .flatMap((s) => { try { return Array.from(s.cssRules); } catch { return []; } })
          .filter((r) => /var\(--[a-z0-9-]+\)/i.test(r.cssText || ''))
          .length,
        space4: cs.getPropertyValue('--space-4').trim(),
        bg: cs.getPropertyValue('--bg').trim(),
        font: body.fontFamily,
        bodyPadding: body.padding,
      };
    });

    if (!seen.title) note('the exported file renders no report title');
    if (seen.pages < 2) note(`only ${seen.pages} page(s) rendered: the export should carry every page`);
    if (seen.blocks < 20) note(`only ${seen.blocks} block elements rendered`);
    if (!seen.svgs) note('no chart rendered in the exported file');
    if (!seen.metrics) note('no metric tile rendered in the exported file');
    if (!seen.evidence) note('no evidence disclosure survived the export');

    // The defect that started this script: tokens present on screen and
    // absent in the file.
    if (!seen.space4) note('--space-4 has no value in the exported file, so it has no spacing');
    if (!seen.bg) note('--bg has no value in the exported file, so it has no surface colours');
    if (!seen.font || /^-?apple-system$/.test(seen.font) === false && seen.font.includes('Times')) {
      note(`the exported file falls back to a default serif font: ${seen.font}`);
    }

    const fetched = blocked.filter((u) => !u.includes('example.invalid'));
    if (fetched.length) {
      note(`the exported file tried to fetch ${fetched.length} resource(s) to render, first: ${fetched[0]}`);
    }

    console.log(`  ${seen.pages} pages, ${seen.blocks} blocks, ${seen.svgs} charts, ${seen.metrics} metric tiles`);
    console.log(`  tokens resolved in the file: --space-4=${seen.space4 || 'MISSING'} --bg=${seen.bg || 'MISSING'}`);
    console.log(`  requests refused while rendering: ${blocked.length} (${fetched.length} not the report's own citations)`);
  } finally {
    await browser.close();
    server.kill();
  }

  if (findings.length) {
    for (const f of findings) console.error(`  ${f}`);
    return 1;
  }
  console.log('  the exported file stands on its own');
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`  could not run: ${err.message}`);
  process.exit(2);
});
