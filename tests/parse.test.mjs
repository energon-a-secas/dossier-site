/**
 * Parser tests: parse.js
 *
 * Plain node --test, no framework, no dependencies.
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { parse, derive } from '../js/parse.js';

describe('parse', () => {
  test('JSON: valid document', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "One",
          "blocks": [{
            "type": "prose",
            "text": "Hello"
          }]
        }]
      }
    }`;
    const result = parse(json);
    assert.strictEqual(result.fatal, null);
    assert.notStrictEqual(result.model, null);
    assert.strictEqual(result.model.dossier.title, 'Test');
  });

  test('JSON: bare document normalization', () => {
    const json = `{
      "version": 1,
      "title": "Bare",
      "pages": [{
        "title": "Page",
        "blocks": [{"type": "prose", "text": "Test"}]
      }]
    }`;
    const result = parse(json);
    assert.strictEqual(result.fatal, null);
    assert.strictEqual(result.model.dossier.title, 'Bare');
    assert.strictEqual(result.findings.some((f) => f.message.includes('normalised')), true);
  });

  test('JSON: syntax error', () => {
    const result = parse('{ "broken": ');
    assert.notStrictEqual(result.fatal, null);
    assert.strictEqual(result.model, null);
    assert.strictEqual(result.fatal.message.length > 0, true);
  });

  test('parse is pure: same model structure returned', () => {
    const input = `{"dossier": {"version": 1, "title": "T", "pages": [{"title": "P", "blocks": [{"type": "prose", "title": "B", "text": "h"}]}]}}`;
    const r1 = parse(input);
    const r2 = parse(input);
    assert.deepStrictEqual(r1.model, r2.model);
  });

  test('numeric string coercion', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "metrics",
            "items": [{
              "label": "X",
              "value": "42"
            }]
          }]
        }]
      }
    }`;
    const result = parse(json);
    const item = result.model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(typeof item.value, 'number');
    assert.strictEqual(item.value, 42);
    assert.strictEqual(result.findings.some((f) => f.message.includes('Coerced')), true);
  });

  test('single value to array coercion', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "metrics",
            "items": {
              "label": "X",
              "value": 42
            }
          }]
        }]
      }
    }`;
    const result = parse(json);
    const block = result.model.dossier.pages[0].blocks[0];
    assert.strictEqual(Array.isArray(block.items), true);
  });

  test('delete supplied derived field: page id', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "id": "should-be-deleted",
          "title": "Page",
          "blocks": [{"type": "prose", "text": "h"}]
        }]
      }
    }`;
    const result = parse(json);
    const page = result.model.dossier.pages[0];
    assert.strictEqual(page.id === 'should-be-deleted', false);
    assert.strictEqual(result.findings.some((f) => f.message.includes('derived')), true);
  });

  test('delete supplied derived field: block id', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "prose",
            "title": "Block Title",
            "id": "should-be-deleted",
            "text": "h"
          }]
        }]
      }
    }`;
    const result = parse(json);
    const block = result.model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.id, 'block-title');
    assert.strictEqual(result.findings.some((f) => f.message.includes('derived')), true);
  });

  test('malformed block is kept with __error', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "invalid-type",
            "text": "h"
          }]
        }]
      }
    }`;
    const result = parse(json);
    assert.notStrictEqual(result.model, null);
    const block = result.model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.type, 'invalid-type');
  });

  test('metric delta derivation: good direction', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "metrics",
            "items": [{
              "label": "Latency",
              "value": 180,
              "baseline": 340,
              "better": "lower"
            }]
          }]
        }]
      }
    }`;
    const result = parse(json);
    const item = result.model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.delta, -160);
    assert.strictEqual(item.deltaPct, -47.06);
    assert.strictEqual(item.direction, 'good');
  });

  test('metric delta: zero baseline', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "metrics",
            "items": [{
              "label": "X",
              "value": 100,
              "baseline": 0
            }]
          }]
        }]
      }
    }`;
    const result = parse(json);
    const item = result.model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.delta, 100);
    assert.strictEqual(item.deltaPct, undefined);
  });

  test('page id derived from title', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "My Great Page",
          "blocks": [{"type": "prose", "text": "h"}]
        }]
      }
    }`;
    const result = parse(json);
    const page = result.model.dossier.pages[0];
    assert.strictEqual(page.id, 'my-great-page');
  });

  test('block id derived from title', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [{
            "type": "prose",
            "title": "Important Block",
            "text": "h"
          }]
        }]
      }
    }`;
    const result = parse(json);
    const block = result.model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.id, 'important-block');
  });

  test('block id collision suffixed', () => {
    const json = `{
      "dossier": {
        "version": 1,
        "title": "Test",
        "pages": [{
          "title": "P",
          "blocks": [
            {"type": "prose", "title": "Same", "text": "1"},
            {"type": "prose", "title": "Same", "text": "2"}
          ]
        }]
      }
    }`;
    const result = parse(json);
    const blocks = result.model.dossier.pages[0].blocks;
    assert.strictEqual(blocks[0].id, 'same');
    assert.strictEqual(blocks[1].id, 'same-1');
  });
});
