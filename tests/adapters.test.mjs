/**
 * Adapter tests: adapters/*.js
 *
 * Round-trip each adapter sample and assert structure.
 *
 * Plain node --test, no framework, no dependencies.
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { toDossier as numstatToDossier } from '../js/adapters/numstat.js';
import { toDossier as junitToDossier } from '../js/adapters/junit.js';
import { toDossier as sarifToDossier } from '../js/adapters/sarif.js';
import { toDossier as ctrfToDossier } from '../js/adapters/ctrf.js';
import { toDossier as markdownToDossier } from '../js/adapters/markdown.js';
import { toDossier as lighthouseToDossier } from '../js/adapters/lighthouse.js';
import { toDossier as htmlToDossier } from '../js/adapters/html.js';
import { detect } from '../js/adapters/index.js';
import { parse } from '../js/parse.js';
import { validate } from '../js/validate.js';
import { blockHtml } from '../js/render/index.js';
import { escHtml } from '../js/neorgon-dom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const fixturesDir = join(__dirname, '..', 'fixtures', 'foreign');

function readFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('adapters', () => {
  describe('HTML', () => {
    test('detection returns a usable adapter and prioritizes the enclosing document', () => {
      const adapter = detect('<!DOCTYPE html><html><body><pre>\n# A heading\nfix: a change</pre></body></html>');
      assert.strictEqual(adapter.id, 'html');
      assert.strictEqual(typeof adapter.toDossier, 'function');
      assert.strictEqual(detect('# A heading').id, 'markdown');
      assert.strictEqual(detect('<testsuite name="unit"></testsuite>').id, 'junit');
    });

    test('native documents containing markup are not mistaken for HTML', () => {
      assert.strictEqual(detect(JSON.stringify({ dossier: { pages: [{ blocks: [{ html: '<p>Report</p>' }] }] } })), null);
      assert.strictEqual(detect('{ "html": "<p>unfinished'), null);
    });

    test('styles, SVGs and scripts survive an HTML import as a valid embed', () => {
      const source = readFixture('presentation.html');
      const converted = htmlToDossier(source);
      const block = converted.document.dossier.pages[0].blocks[0];
      assert.strictEqual(block.html, source);
      assert.strictEqual(block.scripts, true);
      const parsed = parse(JSON.stringify(converted.document));
      assert.strictEqual(parsed.fatal, null);
      assert.deepEqual(validate(parsed.model).filter((finding) => finding.level === 'error'), []);
    });

    test('passive HTML does not enable scripts', () => {
      assert.strictEqual(htmlToDossier('<h1>Report</h1>').document.dossier.pages[0].blocks[0].scripts, false);
      assert.strictEqual(htmlToDossier(' ').document, null);
    });

    test('interactive embeds use the isolated host; offline exports include the document', () => {
      const block = { type: 'embed', html: '<button onclick="this.textContent=2">1</button>', scripts: true };
      const live = blockHtml(block);
      const offline = blockHtml(block, { standalone: true });
      assert.ok(live.includes('src="embed.html"'));
      assert.ok(live.includes('sandbox="allow-scripts"'));
      assert.ok(!live.includes('allow-same-origin'));
      assert.ok(offline.includes('srcdoc='));
      assert.ok(!offline.includes('src="embed.html"'));
      assert.ok(offline.includes('Content-Security-Policy'));
      assert.ok(offline.includes('connect-src &#39;none&#39;'));
    });
  });

  describe('numstat', () => {
    test('parses git diff output', () => {
      const source = readFixture('numstat.txt');
      const result = numstatToDossier(source);
      assert.notStrictEqual(result.document, null);
      assert.strictEqual(result.document.dossier.pages.length, 1);
      const page = result.document.dossier.pages[0];
      assert.strictEqual(page.blocks.length, 2);
      assert.strictEqual(page.blocks[0].type, 'files');
      assert.strictEqual(page.blocks[1].type, 'metrics');
      assert.strictEqual(page.blocks[0].items.length, 4);
    });
  });

  describe('junit', () => {
    test('parses JUnit XML', () => {
      const source = readFixture('junit.xml');
      const result = junitToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const testsBlock = page.blocks.find((b) => b.type === 'tests');
      assert.notStrictEqual(testsBlock, undefined);
      assert.strictEqual(testsBlock.items.length, 4);
      const failed = testsBlock.items.find((t) => t.state === 'failed');
      assert.notStrictEqual(failed, undefined);
    });
  });

  describe('sarif', () => {
    test('parses SARIF findings', () => {
      const source = readFixture('sarif.json');
      const result = sarifToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const findingsBlock = page.blocks.find((b) => b.type === 'findings');
      assert.notStrictEqual(findingsBlock, undefined);
      assert.strictEqual(findingsBlock.items.length, 2);
    });
  });

  describe('ctrf', () => {
    test('parses CTRF results', () => {
      const source = readFixture('ctrf.json');
      const result = ctrfToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const testsBlock = page.blocks.find((b) => b.type === 'tests');
      assert.notStrictEqual(testsBlock, undefined);
    });
  });

  describe('markdown', () => {
    test('parses Markdown with front matter', () => {
      const source = readFixture('markdown.md');
      const result = markdownToDossier(source);
      assert.notStrictEqual(result.document, null);
      assert.strictEqual(result.document.dossier.title, 'Performance Report');
      assert.strictEqual(result.document.dossier.pages.length, 1);
    });
  });

  describe('lighthouse', () => {
    test('parses Lighthouse LHR', () => {
      const source = readFixture('lighthouse.json');
      const result = lighthouseToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const metricsBlock = page.blocks.find((b) => b.type === 'metrics');
      assert.notStrictEqual(metricsBlock, undefined);
      assert.strictEqual(metricsBlock.items.length, 4);
    });
  });
});

/**
 * Every foreign input, all the way through: detect, convert, parse, validate,
 * render. The per-adapter tests above check structure (a tests block exists,
 * it has four items), which is how the Markdown adapter shipped headings in a
 * field the renderer never reads, JUnit and CTRF put failure output in a field
 * the format does not have, Lighthouse wrote a level outside the enum, and the
 * CTRF fixture could not be detected at all. Each of those documents had the
 * right shape; none of them showed its words.
 */
describe('foreign inputs round trip', () => {
  const TEXT_KEYS = new Set(['title', 'label', 'text', 'value', 'detail', 'note', 'message', 'name', 'at', 'path', 'suite', 'rule']);
  const texts = (value, out = [], key = '') => {
    if (Array.isArray(value)) value.forEach((v) => texts(v, out, key));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) if (k !== 'html' && k !== 'extra') texts(v, out, k);
    } else if (typeof value === 'string' && TEXT_KEYS.has(key)) {
      for (const line of value.split('\n')) if (line.trim().length > 2) out.push([key, line.trim()]);
    }
    return out;
  };
  const plainWords = (s) => s.replace(/\*\*|`|\*/g, '');

  /** Findings that mean a converted document is wrong, not merely thin. */
  function problems(source) {
    const adapter = detect(source);
    if (!adapter) return { adapter: null, bad: ['not detected'], model: null };
    const { document } = adapter.toDossier(source);
    if (!document) return { adapter, bad: ['no document'], model: null };
    const parsed = parse(JSON.stringify(document));
    if (parsed.fatal) return { adapter, bad: [`fatal: ${parsed.fatal.message}`], model: null };
    const bad = validate(parsed.model)
      .filter((f) => f.level === 'error' || /\.(unknown|alias)$/.test(f.rule || '') || /^Unknown field/.test(f.message))
      .map((f) => `${f.level} ${f.path}: ${f.message}`);
    return { adapter, bad, model: parsed.model };
  }

  function missingWords(model) {
    const missing = [];
    for (const page of model.dossier.pages) {
      for (const block of page.blocks) {
        const html = blockHtml(block, { page });
        const plain = html.replace(/<[^>]*>/g, '');
        for (const [key, value] of texts(block)) {
          if (!html.includes(escHtml(value)) && !plain.includes(escHtml(plainWords(value)))) {
            missing.push(`${block.type}.${key} "${value.slice(0, 48)}"`);
          }
        }
      }
    }
    return missing;
  }

  const EXPECTED = {
    'ctrf.json': 'ctrf',
    'junit.xml': 'junit',
    'lighthouse.json': 'lighthouse',
    'markdown.md': 'markdown',
    'numstat.txt': 'numstat',
    'presentation.html': 'html',
    'sarif.json': 'sarif',
  };

  test('every fixture in fixtures/foreign is covered here', () => {
    assert.deepEqual(readdirSync(fixturesDir).sort(), Object.keys(EXPECTED).sort());
  });

  for (const [name, id] of Object.entries(EXPECTED)) {
    test(`${name} is detected as ${id}, validates with no error or unknown field, and shows its words`, () => {
      const { adapter, bad, model } = problems(readFixture(name));
      assert.strictEqual(adapter?.id, id);
      assert.deepEqual(bad, []);
      assert.deepEqual(missingWords(model), []);
    });
  }

  test('Conventional Commits convert to a valid table, from one commit or many', () => {
    for (const log of ['fix: one thing', 'feat(limiter): share one counter\nfix: handle store outage\nchore!: drop node 16']) {
      const { adapter, bad, model } = problems(log);
      assert.strictEqual(adapter?.id, 'commits');
      assert.deepEqual(bad, []);
      assert.deepEqual(missingWords(model), []);
    }
    const html = blockHtml(problems('feat(limiter)!: share one counter\ndocs: readme').model.dossier.pages[0].blocks[0]);
    for (const word of ['feat', 'limiter', 'share one counter', 'yes', 'docs', 'readme']) assert.ok(html.includes(word), word);
  });

  test('Markdown headings and blockquotes keep their words', () => {
    const { model } = problems('# Report\n\n## What changed\n\n### Detail\n\n#### Deeper\n\n> Mind the gap.\n');
    const blocks = model.dossier.pages[0].blocks;
    assert.deepEqual(blocks.slice(0, 3).map((b) => [b.type, b.level, b.text]), [
      ['heading', 2, 'What changed'],
      ['heading', 3, 'Detail'],
      ['heading', 3, 'Deeper'],
    ]);
    const html = blocks.map((b) => blockHtml(b)).join('');
    for (const word of ['What changed', 'Detail', 'Deeper', 'Mind the gap.']) assert.ok(html.includes(word), word);
    assert.ok(!html.includes('add &quot;text&quot;'), 'a heading rendered its placeholder');
  });

  test('Markdown with Windows line endings reads its front matter and code', () => {
    const { model } = problems('---\r\ntitle: Windows\r\n---\r\n# Page\r\n\r\n```js\r\nlet a = 1;\r\n```\r\n');
    assert.strictEqual(model.dossier.title, 'Windows');
    const code = model.dossier.pages[0].blocks.find((b) => b.type === 'code');
    assert.strictEqual(code.source, 'let a = 1;');
    assert.strictEqual(code.language, 'js');
  });

  test('JUnit failure output reaches the page, and <error> is the errored state', () => {
    const xml = '<testsuite name="unit" time="1.5"><testcase name="a" time="0.2"><failure message="short">x &lt; y</failure></testcase>'
      + '<testcase name="b"><error message="only the attribute"/></testcase></testsuite>';
    const block = junitToDossier(xml).document.dossier.pages[0].blocks[0];
    assert.deepEqual(block.items.map((t) => [t.state, t.message]), [['failed', 'x < y'], ['errored', 'only the attribute']]);
    assert.strictEqual(block.suite, 'unit');
    assert.strictEqual(block.duration, 1.5);
    const html = blockHtml(block);
    assert.ok(html.includes('x &lt; y'));
    assert.ok(html.includes('only the attribute'));
    const metrics = junitToDossier(xml).document.dossier.pages[0].blocks[1];
    assert.ok(metrics.items.every((m) => !('tone' in m)));
  });

  test('CTRF reads results.tests and the older flat results array', () => {
    const flat = JSON.stringify({ results: [{ name: 'a', status: 'PASSED' }, { name: 'b', status: 'FAILED', message: 'boom' }] });
    assert.strictEqual(detect(flat)?.id, 'ctrf');
    const block = ctrfToDossier(flat).document.dossier.pages[0].blocks[0];
    assert.deepEqual(block.items.map((t) => [t.state, t.message]), [['passed', undefined], ['failed', 'boom']]);
    const spec = ctrfToDossier(readFixture('ctrf.json')).document.dossier;
    assert.strictEqual(spec.title, 'Jest results');
    assert.strictEqual(spec.pages[0].blocks[0].items[0].duration, 0.123);
    assert.strictEqual(detect(JSON.stringify({ results: { summary: {} } })), null);
  });

  test('SARIF level none becomes note, and Lighthouse opportunities are warnings', () => {
    const sarif = JSON.stringify({ runs: [{ results: [{ ruleId: 'r', level: 'none', message: { text: 'fine' } }] }] });
    assert.strictEqual(sarifToDossier(sarif).document.dossier.pages[0].blocks[0].items[0].level, 'note');
    const lh = lighthouseToDossier(readFixture('lighthouse.json')).document.dossier.pages[0].blocks;
    assert.ok(lh.find((b) => b.type === 'findings').items.every((f) => f.level === 'warning'));
    assert.ok(lh.find((b) => b.type === 'metrics').items.every((m) => m.target === 90 && m.baseline === undefined));
  });
});
