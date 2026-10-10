/**
 * Derivation tests: derive.js
 *
 * Plain node --test, no framework, no dependencies.
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { derive } from '../js/derive.js';

describe('derive', () => {
  test('metric delta from baseline', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'X',
              value: 50,
              baseline: 100,
            }],
          }],
        }],
      },
    };
    derive(model);
    const item = model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.delta, -50);
  });

  test('metric deltaPct calculation', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'X',
              value: 75,
              baseline: 100,
            }],
          }],
        }],
      },
    };
    derive(model);
    const item = model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.deltaPct, -25);
  });

  test('metric direction: higher is better, delta positive', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'X',
              value: 120,
              baseline: 100,
              better: 'higher',
            }],
          }],
        }],
      },
    };
    derive(model);
    const item = model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.direction, 'good');
  });

  test('metric direction: lower is better, delta negative', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'Latency',
              value: 100,
              baseline: 200,
              better: 'lower',
            }],
          }],
        }],
      },
    };
    derive(model);
    const item = model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.direction, 'good');
  });

  test('metric direction: neutral when no change', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'X',
              value: 100,
              baseline: 100,
            }],
          }],
        }],
      },
    };
    derive(model);
    const item = model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.direction, 'neutral');
  });

  test('files totals derived', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'files',
            items: [
              { path: 'a.js', added: 10, removed: 5 },
              { path: 'b.js', added: 20, removed: 8 },
            ],
          }],
        }],
      },
    };
    derive(model);
    const block = model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.totals.count, 2);
    assert.strictEqual(block.totals.added, 30);
    assert.strictEqual(block.totals.removed, 13);
  });

  test('scorecard passed count', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'scorecard',
            criteria: [
              { label: 'One', verdict: 'pass' },
              { label: 'Two', verdict: 'fail' },
              { label: 'Three', verdict: 'pass' },
            ],
          }],
        }],
      },
    };
    derive(model);
    const block = model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.passed, 2);
  });

  test('diff stats parsed', () => {
    const patch = '@@ -10,7 +10,8 @@\n-old line\n+new line\n+another line\n another line\n';
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'diff',
            patch,
          }],
        }],
      },
    };
    derive(model);
    const block = model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.stats.removed, 1);
    assert.strictEqual(block.stats.added, 2);
  });

  test('log lines counted', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'log',
            source: 'line 1\nline 2\nline 3',
          }],
        }],
      },
    };
    derive(model);
    const block = model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.lines, 3);
  });

  test('chart max derived to round ceiling', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'chart',
            form: 'bar',
            series: [{
              label: 'X',
              values: [0, 48, 120, 85, 350],
            }],
          }],
        }],
      },
    };
    derive(model);
    const block = model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.max, 500);
  });

  test('checklist done count', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'checklist',
            items: [
              { label: 'One', state: 'done' },
              { label: 'Two', state: 'todo' },
              { label: 'Three', state: 'done' },
            ],
          }],
        }],
      },
    };
    derive(model);
    const block = model.dossier.pages[0].blocks[0];
    assert.strictEqual(block.done, 2);
  });

  test('derive is pure: same model state after', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'X',
              value: 50,
              baseline: 100,
            }],
          }],
        }],
      },
    };
    const before = JSON.stringify(model);
    derive(model);
    derive(model);
    const after = JSON.stringify(model);
    assert.strictEqual(before !== after, true);
    const second = JSON.stringify(model);
    assert.strictEqual(after, second);
  });

  test('page id derived', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'My Page Title',
          blocks: [{ type: 'prose', text: 'h' }],
        }],
      },
    };
    derive(model);
    assert.strictEqual(model.dossier.pages[0].id, 'my-page-title');
  });

  test('block id derived', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'prose',
            title: 'Block Title',
            text: 'h',
          }],
        }],
      },
    };
    derive(model);
    assert.strictEqual(model.dossier.pages[0].blocks[0].id, 'block-title');
  });

  test('zero baseline does not compute percentage', () => {
    const model = {
      dossier: {
        version: 1,
        title: 'Test',
        pages: [{
          title: 'P',
          blocks: [{
            type: 'metrics',
            items: [{
              label: 'X',
              value: 50,
              baseline: 0,
            }],
          }],
        }],
      },
    };
    derive(model);
    const item = model.dossier.pages[0].blocks[0].items[0];
    assert.strictEqual(item.delta, 50);
    assert.strictEqual(item.deltaPct, undefined);
  });
});
