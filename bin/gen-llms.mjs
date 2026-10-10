#!/usr/bin/env node

/**
 * Generate llms.txt and SKILL.md from the registry.
 *
 * v2 format: instructions and a worked example, not a tour.
 */

import { BLOCKS, blockDef, groups } from '../js/registry/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Generate llms.txt
const llmsTxt = generateLlmsTxt();
fs.writeFileSync(path.join(__dirname, '../llms.txt'), llmsTxt, 'utf-8');
console.log('Generated llms.txt');

// Generate SKILL.md
const skillMd = generateSkillMd();
fs.writeFileSync(path.join(__dirname, '../SKILL.md'), skillMd, 'utf-8');
console.log('Generated SKILL.md');

process.exit(0);

// ============================================================================

function generateLlmsTxt() {
  const lines = [];

  lines.push('# Dossier');
  lines.push('');
  lines.push('> Emit AI-written work reports as JSON: describe the measurements and claims, and the renderer derives the charts and totals.');
  lines.push('');
  lines.push('- Live: https://dossier.neorgon.com');
  lines.push('- Schema: https://dossier.neorgon.com/schema.json');
  lines.push('- Fixtures: https://dossier.neorgon.com/fixtures/');
  lines.push('');

  lines.push('## Emit this');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    dossier: {
      version: 1,
      title: 'Rate limiter fix',
      pages: [
        {
          title: 'Overview',
          blocks: [
            {
              type: 'metrics',
              title: 'Measured results',
              items: [
                { label: 'p95 latency', value: 182, unit: 'ms', baseline: 340, better: 'lower' },
              ],
            },
          ],
        },
      ],
    },
  }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## Blocks');
  lines.push('');
  lines.push('| Type | Purpose | Required fields |');
  lines.push('|------|---------|-----------------|');

  for (const block of BLOCKS) {
    const reqFields = Object.entries(block.fields || {})
      .filter(([, f]) => f?.required)
      .map(([name]) => name)
      .join(', ');

    const row = `| \`${block.id}\` | ${block.summary} | ${reqFields || 'none'} |`;
    lines.push(row);
  }
  lines.push('');

  lines.push('## Rules');
  lines.push('');
  lines.push('- State what was measured. Do not compute from it. `delta`, `deltaPct`, `direction`, `totals`, `passed`, `done`, `stats`, `lines` and `id` are derived by the renderer, and a supplied one is reported and replaced.');
  lines.push('- Narrative fields (`text`, `note`, `detail`, `excerpt`) are plain strings. Write them normally. Only inline markdown renders: bold, italic, code and links.');
  lines.push('- Set `unit` on every number and `better` on every metric that has a baseline. Without `better` the arrow assumes higher is good, which is wrong for latency and error rates.');
  lines.push('- Nothing is rejected. An unknown block type renders as an error card naming the type, a malformed block renders as an error card in its place, and the rest of the report still renders. Unknown fields are reported once and carried through; put your own fields in `extra` to keep them quiet.');
  lines.push('- Say what you did not do. A skipped or blocked `checklist` item without a `note`, a `fail` in a `scorecard` without a `detail`, and a high `risks` entry without a `mitigation` are all reported. An unexplained gap reads as an oversight rather than a decision.');
  lines.push('');

  lines.push('## Evidence, which is the point');
  lines.push('');
  lines.push('Any block takes an `evidence` array. The report header counts how many claims have none, so this is the field that decides whether a reader believes the rest.');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    type: 'metrics',
    items: [{ label: 'p95 latency', value: 182, unit: 'ms', baseline: 340, better: 'lower' }],
    evidence: [
      { label: 'Load test run 8812, 200 rps for 60s', kind: 'run', checkedBy: 'code', href: 'https://example.invalid/runs/8812' },
      { label: 'Assumed production traffic resembles staging', kind: 'other', checkedBy: 'llm', confidence: 'low' },
    ],
  }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('`checkedBy` is the most useful field in the format and the one to be honest about:');
  lines.push('');
  lines.push('| Value | Means |');
  lines.push('|-------|-------|');
  lines.push('| `code` | A machine check that passed: a test run, a scan, a byte comparison. |');
  lines.push('| `human` | A person looked at it. |');
  lines.push('| `llm` | You asserted it. Rendered as the weaker thing it is, which is correct. |');
  lines.push('| `none` | Nothing checked it. Preferred to leaving the field out. |');
  lines.push('');
  lines.push('Mark your own reasoning `llm`. A report where everything claims `code` and one thing was actually inferred is worse than one that says so, because it makes the reader distrust the rest.');
  lines.push('');

  lines.push('## Bringing other formats in');
  lines.push('');
  lines.push('These are read natively, so hand over the tool output rather than retyping it as prose: a `git diff --numstat` or `--name-status`, JUnit style XML, SARIF 2.1.0, a CTRF test report, a Lighthouse JSON report, a Conventional Commits log, Markdown, and plain HTML. The site detects which it got and converts it into blocks, then reports what it could not carry.');
  lines.push('');

  lines.push('## Handing a report over');
  lines.push('');
  lines.push('- A link carries the whole report in its fragment: `#dz=<base64url of deflate-raw JSON>`. Nothing is uploaded, and anyone with the link has the report.');
  lines.push('- `?src=<https url>` renders a document you host.');
  lines.push('- The one HTML file export opens with no account, no install and no network. That is the one to attach to a ticket.');
  lines.push('- Keep a link under about 8,000 characters. Above that some chat clients cut it, and the file is the better answer.');
  lines.push('');

  lines.push('## Check it before you ship it');
  lines.push('');
  lines.push('```bash');
  lines.push('node bin/validate.mjs <file.json>');
  lines.push('```');
  lines.push('');
  lines.push('Exit codes: 0 clean, 1 findings, 2 could not run.');
  lines.push('');

  lines.push('## What this cannot judge');
  lines.push('');
  lines.push('- Whether a number is correct. Only the format is checked.');
  lines.push('- Whether a claim is true. Evidence links are carried, not verified.');
  lines.push('- Whether a reader can understand it. Plain language is on you.');
  lines.push('');

  return lines.join('\n');
}

function generateSkillMd() {
  const lines = [];

  lines.push('# Emit a Dossier work report');
  lines.push('');
  lines.push('A work report is a JSON document that renders as a dashboard in the browser. The agent states facts, the renderer derives the math: deltas, totals, chart axes. A malformed block renders as an error card and the page keeps rendering.');
  lines.push('');

  lines.push('## Minimum valid report');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    dossier: {
      version: 1,
      title: 'The work you did',
      pages: [{
        title: 'First page',
        blocks: [{
          type: 'prose',
          text: 'What happened.',
        }],
      }],
    },
  }, null, 2));
  lines.push('```');
  lines.push('');

  lines.push('## Block choice guide');
  lines.push('');

  const byGroup = groups();
  for (const [group, blocks] of byGroup) {
    lines.push(`### ${group}`);
    lines.push('');

    for (const block of blocks) {
      lines.push(`**${block.name}** (\`${block.id}\`): ${block.when}`);
      lines.push('');
    }
  }

  lines.push('## Core rules');
  lines.push('');
  lines.push('1. Every page needs at least one block. A document needs at least one page.');
  lines.push('2. Derived fields (delta, passed, done, totals, id) are never supplied. The renderer computes them from the stated facts.');
  lines.push('3. Narrative fields (text, detail, excerpt) accept inline markdown: `**bold**`, `*italic*`, `` `code` ``, `[link](url)`. Never block HTML.');
  lines.push('4. Evidence is optional on any claim block. Supply a checkedBy to say who verified it: code (test/linter), human (someone looked), llm (a model asserted it).');
  lines.push('5. Unknown block types cause an error. Unknown fields on known blocks are carried through but never rendered.');
  lines.push('');

  lines.push('## Validate');
  lines.push('');
  lines.push('```bash');
  lines.push('node bin/validate.mjs <file.json>');
  lines.push('```');
  lines.push('');
  lines.push('0 = clean, 1 = findings, 2 = could not parse.');
  lines.push('');

  return lines.join('\n');
}
