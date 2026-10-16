/**
 * The Presentation Sage deck names an unlabelled compare side the way the
 * report on screen does. It said Left and Right while the screen said Before
 * and After, so the same comparison read two ways.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { deckFromDocument } from '../js/export.js';
import { DEFAULT_SIDE_LABELS, compareHtml } from '../js/render/compare.js';

const deck = (block) => deckFromDocument({ dossier: { version: 1, title: 'T', pages: [{ title: 'P', blocks: [block] }] } })
  .presentation.slides[1];

test('an unlabelled text comparison uses the renderer’s side names', () => {
  const block = { type: 'compare', kind: 'text', left: { value: 'old wording' }, right: { value: 'new wording' } };
  const slide = deck(block);
  assert.equal(slide.type, 'split');
  assert.equal(slide.left.heading, DEFAULT_SIDE_LABELS[0]);
  assert.equal(slide.right.heading, DEFAULT_SIDE_LABELS[1]);
  // And they are the words the screen shows for the same block.
  const screen = compareHtml(block, {});
  for (const name of DEFAULT_SIDE_LABELS) assert.ok(screen.includes(name), `the screen does not say ${name}`);
  assert.ok(!JSON.stringify(slide).includes('"Left"') && !JSON.stringify(slide).includes('"Right"'));
});

test('an unlabelled image comparison uses them for label and alt text', () => {
  const slide = deck({ type: 'compare', kind: 'image', left: { src: 'data:image/png;base64,AA' }, right: { src: 'data:image/png;base64,AB' } });
  assert.equal(slide.type, 'compare');
  assert.equal(slide.before.label, DEFAULT_SIDE_LABELS[0]);
  assert.equal(slide.before.alt, DEFAULT_SIDE_LABELS[0]);
  assert.equal(slide.after.label, DEFAULT_SIDE_LABELS[1]);
  assert.equal(slide.after.alt, DEFAULT_SIDE_LABELS[1]);
});

test('an author’s labels still win', () => {
  const slide = deck({ type: 'compare', kind: 'text', left: { label: 'Human', value: 'a' }, right: { label: 'Agent', value: 'b' } });
  assert.equal(slide.left.heading, 'Human');
  assert.equal(slide.right.heading, 'Agent');
});
