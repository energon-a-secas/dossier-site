/**
 * js/compare/numbers.js and its marks: the numbers that changed between a
 * column and its reference, listed and kept marked even in a column shown
 * with margin bars only. A list of differences, never a score.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { diffBlocks } from '../js/compare/diff.js';
import { numberChanges, numberMarks, isNumberToken } from '../js/compare/numbers.js';
import { columnMarks } from '../js/compare/marks.js';
import { renderIr } from '../js/compare/ir-render.js';
import { markdownToIr } from '../js/compare/markdown-ir.js';

const md = (text) => markdownToIr(text).blocks;

const BASE = [
  '# EOL roadmap',
  '',
  '- **1,105** Redis 6 nodes',
  '- 40 Postgres clusters',
  '',
  'Extended support would cost $19.8M in surcharges over 3 years.',
  '',
  'Platform teams own the upgrade plan and the dates for each service in the program.',
  '',
  'The review board meets every second Tuesday to look at the progress so far and to agree on the next steps for each team in turn.',
  '',
  'Each team keeps its own list of end of life dates in a spreadsheet that nobody else reads, and the lists rarely agree with each other.',
  '',
  'Vendors announce dates with little warning, so the board keeps a margin of a quarter before every published end of support.',
].join('\n');

const AGENT = [
  '# EOL roadmap',
  '',
  '- **1,150** Redis 6 nodes',
  '- 40 Postgres clusters',
  '',
  'Extended support would cost $21.4M in surcharges over 3 years.',
  '',
  'Platform teams own the upgrade plan and also the timeline for every service in the program.',
  '',
  'A steering group gathers monthly to review status across every program and publishes a short written summary afterwards.',
  '',
  'Ownership of upgrade tracking moves to a central registry, which replaces scattered documents with one shared source of truth.',
  '',
  'Automated alerts warn service owners well ahead of support deadlines, removing the need for manual calendar reminders.',
].join('\n');

test('a number token is a number as a report writes it', () => {
  for (const t of ['1,105', '$19.8M', '6.2%', '6.2.6', '14:04', '3']) assert.ok(isNumberToken(t), t);
  for (const t of ['Redis', 'v6', 'M']) assert.ok(!isNumberToken(t), t);
});

test('the changed numbers of a column too different to mark word by word, with their change numbers', () => {
  const r = diffBlocks(md(BASE), md(AGENT));
  assert.equal(r.tooDifferent, true, 'the fixture is too different for word marks');
  const list = numberChanges(r);
  assert.deepEqual(list.map((c) => [c.wasText, c.nowText, c.kind]), [['1,105', '1,150', 'li'], ['$19.8M', '$21.4M', 'p']]);
  for (const c of list) assert.equal(r.changes[c.n - 1].unit, c.unit, 'n is the change number the marks give it');
  assert.equal(numberChanges(r), list, 'worked out once per result');
  assert.match(list[0].context, /^1,150 Redis 6 nodes$/);
});

test('a passage with one number against nine, and a number on one side only, are not listed', () => {
  const r = diffBlocks(md('# T\n\nWe run 1 cluster in the eu region today and it is fine.\n\n## Database work\n\nAgreed in planning.'),
    md('# T\n\nWe run 9 clusters in 4 regions: 2 old, 3 new, 1 shared, 5 nodes, 6 disks, 7 racks, 8 hosts in the eu region today.\n\n## Theme 1: Database work\n\nAgreed in planning.'));
  assert.deepEqual(numberChanges(r), []);
  const one = diffBlocks(md('Latency was high on the day of the release.'), md('Latency was 3.4 s on the day of the release.'));
  assert.deepEqual(numberChanges(one), [], 'a number on one side only is not a changed number');
});

test('with margin bars, a changed number keeps its marks and nothing else does', () => {
  const r = diffBlocks(md(BASE), md(AGENT));
  const html = renderIr(md(AGENT), { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'A', bars: true }) });
  const item = html.match(/<li class="unit u-bar-chg"[^>]*>.*?<\/li>/)[0];
  assert.equal((item.match(/<del>/g) || []).length, 1);
  assert.equal((item.match(/<ins>/g) || []).length, 1);
  assert.match(item, /<del><span class="visually-hidden">deleted: <\/span><strong>1,105<\/strong><\/del>/);
  assert.match(item, /<ins><span class="visually-hidden">inserted: <\/span><strong>1,150<\/strong><\/ins>/);
  const owner = html.match(/<p class="unit u-bar-chg"[^>]*>[^]*?<\/p>/g).find((p) => /Platform teams/.test(p));
  assert.ok(owner && !/<ins>|<del>/.test(owner), 'a changed paragraph with no number change has no marks');
  // What is left once the kept removals are dropped is the column's own text.
  const text = (h) => h.replace(/<del>[^]*?<\/del>/g, '').replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ').replace(/ ([,.;:)%])/g, '$1').trim();
  for (const [index, slot] of r.units.entries()) {
    if (slot.state !== 'changed') continue;
    const unit = html.match(new RegExp(`<(li|p)[^>]*data-u="${index}"[^>]*>([^]*?)</\\1>`));
    const own = text(unit[2].replace(/<span class="visually-hidden[^"]*">[^<]*<\/span>/g, ''));
    assert.equal(own, r.colUnits[index].text.replace(/\s+/g, ' ').replace(/ ([,.;:)%])/g, '$1').trim());
  }
  assert.ok(numberMarks(r).size === 2);
});
