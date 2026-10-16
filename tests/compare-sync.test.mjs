/**
 * js/compare/sync.js `followerTarget`: where a follower column goes for a
 * leader's scroll position. Sections mode must be continuous from the top to
 * the end: a 1 px scroll of the leader near its top once sent the follower
 * about 100 px down, because the reading line (30 % down) was mapped from
 * the first pixel.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { followerTarget, createSync, READING_LINE } from '../js/compare/sync.js';
import { alignHeadings } from '../js/compare/align.js';

// A leader 4000 px long and a follower 5000 px long, both 700 px tall, whose
// matched headings sit further down in the follower (its intro is longer).
const columns = {
  leadView: 700, leadHeight: 4000, followView: 700, followHeight: 5000,
  anchors: [[400, 900], [1200, 1900], [2600, 3400], [3500, 4500]],
};
const target = (y, extra = {}) => followerTarget({ ...columns, ...extra, y });

/** The largest move of the follower for a 1 px move of the leader, over [from, to]. */
function steepest(from, to, extra) {
  let most = 0;
  for (let y = from + 1; y <= to; y += 1) most = Math.max(most, Math.abs(target(y, extra) - target(y - 1, extra)));
  return most;
}

test('at the top, the follower is at its top, and the first pixels move it a few pixels', () => {
  assert.equal(target(0), 0);
  assert.ok(target(1) < 5, `1 px of the leader moved the follower to ${target(1)} px`);
  assert.ok(target(2) < 10, `2 px of the leader moved the follower to ${target(2)} px`);
  assert.ok(steepest(0, 400) < 6, 'the mapping jumps near the top');
});

test('the mapping is continuous over the whole range and ends at the follower end', () => {
  const leadRange = columns.leadHeight - columns.leadView;
  const followRange = columns.followHeight - columns.followView;
  assert.ok(steepest(0, leadRange) < 6, 'the mapping jumps somewhere');
  assert.equal(target(leadRange), followRange);
  assert.ok(followRange - target(leadRange - 1) < 6, 'one pixel short of the end is far from the follower end');
  // Past either end the leader is clamped.
  assert.equal(target(-50), 0);
  assert.equal(target(leadRange + 50), followRange);
});

test('in the middle, a matched heading on the leader reading line puts the follower heading on its own', () => {
  const y = 1200 - READING_LINE * columns.leadView;
  assert.equal(Math.round(target(y)), Math.round(1900 - READING_LINE * columns.followView));
});

test('a leader shorter than a view still runs from top to end without a jump', () => {
  const short = { leadHeight: 1000, followHeight: 3000, anchors: [[300, 900]] };
  const range = short.leadHeight - columns.leadView;
  assert.equal(target(0, short), 0);
  assert.equal(target(range, short), short.followHeight - columns.followView);
  assert.ok(steepest(0, range, short) < 20, 'a short leader jumps');
});

test('scroll mode and columns without headings keep the same fraction of each range', () => {
  assert.equal(target(1650, { sections: false }), 0.5 * (columns.followHeight - columns.followView));
  assert.equal(target(10, { leadHeight: 700 }), 0, 'a leader that cannot scroll leads nowhere');
});

test('two columns are aligned once, from headings each read once, whichever leads', () => {
  // A scroller as sync needs one, with nothing on a page.
  const stub = () => ({
    y: () => 0, set: () => {}, height: () => 1000, view: () => 500, anchors: () => [], listen: () => () => {},
  });
  let reads = 0;
  const counted = (texts) => texts.map((text) => ({
    level: 2,
    get text() {
      reads += 1;
      return text;
    },
  }));
  const a = ['Summary', 'Customer impact', 'Timeline of events', 'Root causes', 'What we did'];
  const b = ['Summary', 'Root cause', 'Contributing factors', 'Impact', 'Timeline', 'Remediation'];
  const sync = createSync();
  sync.setMode('off');
  sync.register('k1', stub(), counted(a));
  sync.register('k2', stub(), counted(b));
  const forward = sync.pairs('k1', 'k2');
  const backward = sync.pairs('k2', 'k1');
  assert.equal(reads, a.length + b.length, 'each heading text is read once');
  assert.deepEqual(backward, forward.map((p) => ({ a: p.b, b: p.a, sim: p.sim })), 'the other direction is the mirror');
  assert.equal(sync.pairs('k2', 'k1'), backward, 'and is kept');
  const plain = (list) => list.map((text) => ({ text, level: 2 }));
  assert.deepEqual(forward, alignHeadings(plain(a), plain(b)));
  sync.clear();
});

test('a registered column is aligned with the others in idle time, before any scroll', async () => {
  const stub = () => ({
    y: () => 0, set: () => {}, height: () => 1000, view: () => 500, anchors: () => [], listen: () => () => {},
  });
  let reads = 0;
  const counted = (texts) => texts.map((text) => ({
    level: 2,
    get text() {
      reads += 1;
      return text;
    },
  }));
  const sync = createSync();
  sync.register('k1', stub(), counted(['Summary', 'Impact']));
  sync.register('k2', stub(), counted(['Summary', 'Customer impact']));
  assert.equal(reads, 0, 'nothing is read while registering');
  await new Promise((resolve) => { setTimeout(resolve, 120); });
  assert.equal(reads, 4, 'the pair was aligned in idle time');
  sync.pairs('k1', 'k2');
  assert.equal(reads, 4, 'and a scroll finds it ready');
  sync.clear();
});
