/**
 * Test the registry itself.
 * No framework, plain node --test.
 */

import test from 'node:test';
import assert from 'node:assert';
import { auditRegistry, BLOCKS } from '../js/registry/index.js';

test('registry audit finds no problems', () => {
  const problems = auditRegistry();
  if (problems.length > 0) {
    console.error('Registry problems:', problems);
  }
  assert.strictEqual(problems.length, 0);
});

test('every block has required metadata', () => {
  for (const block of BLOCKS) {
    assert.ok(block.id, `Block missing id`);
    assert.ok(block.name, `Block ${block.id} missing name`);
    assert.ok(block.group, `Block ${block.id} missing group`);
    assert.ok(block.summary, `Block ${block.id} missing summary`);
    assert.ok(block.when, `Block ${block.id} missing when`);
    assert.ok(Array.isArray(block.lint), `Block ${block.id} missing lint array`);
  }
});

test('every block has a sample', () => {
  for (const block of BLOCKS) {
    assert.ok(block.sample, `Block ${block.id} missing sample`);
    assert.strictEqual(block.sample.type, block.id,
      `Block ${block.id} sample has wrong type`);
  }
});

test('block count is 27', () => {
  assert.strictEqual(BLOCKS.length, 27);
});
