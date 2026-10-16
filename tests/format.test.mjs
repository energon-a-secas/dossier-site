// A zone west of UTC, as the owner's is: new Date('2026-10-08') is midnight
// UTC, which is the evening of 7 October here. Set before anything formats.
process.env.TZ = 'America/Santiago';

/**
 * Dates in a report read as "8 Oct 2026" wherever the reader is. node --test
 * runs each file in its own process, so the zone above is this file's alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { formatDate, formatDateRange, formatCell, isoDay, enumWord } = await import('../js/render/format.js');
const joined = (parts) => parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
const isos = (parts) => parts.filter((part) => typeof part !== 'string').map((part) => part.iso);

test('the zone this file runs in is west of UTC, so a shifted day would show', () => {
  assert.equal(new Date('2026-10-08').getDate(), 7, 'TZ was not applied');
});

test('a calendar day reads as day, short month and year, on its own day', () => {
  assert.equal(formatDate('2026-10-08'), '8 Oct 2026');
  assert.equal(formatDate('2026-10-01'), '1 Oct 2026');
  assert.equal(formatDate('2026-09-08'), '8 Sep 2026');
  assert.equal(formatDate(' 2026-12-31 '), '31 Dec 2026');
  assert.equal(formatCell('2026-10-08', 'date'), '8 Oct 2026');
});

test('text that is not a real calendar day is the author\'s words, unchanged', () => {
  assert.equal(formatDate('2026-02-30'), '2026-02-30');
  assert.equal(formatDate('2026-10'), '2026-10');
  assert.equal(formatDate('Q3 2026'), 'Q3 2026');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate(null), '');
  assert.equal(isoDay('2026-02-29'), null, '2026 is not a leap year');
  assert.deepEqual(isoDay('2028-02-29'), { year: 2028, month: 2, day: 29 });
});

test('an instant is shown on the reader\'s own day', () => {
  assert.equal(formatDate('2026-10-08T12:00:00Z'), '8 Oct 2026');
  assert.equal(formatDate('2026-10-08T01:00:00Z'), '7 Oct 2026', 'an instant is local, as the reader lives it');
});

test('a window is shortened where its dates share a month or a year', () => {
  const sameMonth = formatDateRange('2026-10-01', '2026-10-15');
  assert.equal(joined(sameMonth), '1 to 15 Oct 2026');
  assert.deepEqual(isos(sameMonth), ['2026-10-01', '2026-10-15']);
  assert.equal(joined(formatDateRange('2026-09-28', '2026-10-03')), '28 Sep to 3 Oct 2026');
  assert.equal(joined(formatDateRange('2025-12-30', '2026-01-02')), '30 Dec 2025 to 2 Jan 2026');
  const mixed = formatDateRange('2026-10-01', 'Q4');
  assert.equal(joined(mixed), '1 Oct 2026 to Q4');
  assert.deepEqual(isos(mixed), ['2026-10-01', null]);
});

test('enum words read as a person would say them', () => {
  assert.equal(enumWord('in-review'), 'In review');
  assert.equal(enumWord('rolled-back'), 'Rolled back');
  assert.equal(enumWord('two-thirds'), 'Two thirds');
  assert.equal(enumWord('llm'), 'Model');
  assert.equal(enumWord('wontfix'), "Won't fix");
  assert.equal(enumWord('constructor'), 'Constructor', 'an inherited property was read as a display word');
  assert.equal(enumWord(undefined), '');
});
