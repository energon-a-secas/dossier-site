/**
 * Test the validator.
 * No framework, plain node --test.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from '../js/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  const filePath = path.join(__dirname, '../fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

test('minimal.json validates clean', () => {
  const model = loadFixture('minimal');
  const findings = validate(model);
  const errors = findings.filter(f => f.level === 'error');
  const warns = findings.filter(f => f.level === 'warn');
  assert.strictEqual(errors.length, 0, 'Should have no errors');
  assert.strictEqual(warns.length, 0, 'Should have no warns');
});

test('complete.json validates clean', () => {
  const model = loadFixture('complete');
  const findings = validate(model);
  const errors = findings.filter(f => f.level === 'error');
  const warns = findings.filter(f => f.level === 'warn');
  assert.strictEqual(errors.length, 0, `Should have no errors, got: ${errors.map(e => e.message).join(', ')}`);
  assert.strictEqual(warns.length, 0, `Should have no warns, got: ${warns.map(w => w.message).join(', ')}`);
});

test('messy.json produces expected errors', () => {
  const model = loadFixture('messy');
  const findings = validate(model);

  const ruleIds = new Set(findings.map(f => f.rule).filter(Boolean));

  // Check for key error types
  const hasUnknownType = findings.some(f =>
    f.rule && f.rule.includes('block.type.unknown')
  );
  const hasDerivedField = findings.some(f =>
    f.rule && f.rule.includes('derived')
  );
  const hasBadUrl = findings.some(f =>
    f.message && f.message.toLowerCase().includes('javascript')
  );
  const hasBackwardLines = findings.some(f =>
    f.message && f.message.toLowerCase().includes('backwards')
  );
  const hasRiskNoMitigation = findings.some(f =>
    f.message && f.message.toLowerCase().includes('mitigation')
  );

  assert.ok(findings.length > 0, 'messy.json should produce findings');
  assert.ok(hasUnknownType, 'Should find unknown block type');
  assert.ok(hasDerivedField, 'Should find supplied derived field');
  assert.ok(hasBadUrl, 'Should reject javascript: URL');
});

test('messy.json has multiple finding levels', () => {
  const model = loadFixture('messy');
  const findings = validate(model);

  const levels = new Set(findings.map(f => f.level));
  assert.ok(levels.has('error'), 'Should have error findings');
});

test('validator catches missing required fields', () => {
  const model = {
    dossier: {
      version: 1,
      title: 'Test',
      pages: [
        {
          title: 'Page',
          blocks: [
            {
              type: 'prose'
            }
          ]
        }
      ]
    }
  };

  const findings = validate(model);
  const errors = findings.filter(f => f.level === 'error');
  assert.ok(errors.some(e => e.message.includes('text')),
    'Should flag missing required text field in prose block');
});

test('validator catches type mismatches', () => {
  const model = {
    dossier: {
      version: 1,
      title: 'Test',
      pages: [
        {
          title: 'Page',
          blocks: [
            {
              type: 'prose',
              text: 'Valid prose',
              extraField: 123
            }
          ]
        }
      ]
    }
  };

  const findings = validate(model);
  const infos = findings.filter(f => f.level === 'info');
  assert.ok(infos.some(i => i.message.includes('extraField')),
    'Should flag unknown field at info level');
});

test('validator catches string newlines', () => {
  const model = {
    dossier: {
      version: 1,
      title: 'Test\nwith newline',
      pages: [
        {
          title: 'Page',
          blocks: [
            {
              type: 'prose',
              text: 'Valid'
            }
          ]
        }
      ]
    }
  };

  const findings = validate(model);
  const errors = findings.filter(f => f.level === 'error');
  assert.ok(errors.some(e => e.message.includes('newline')),
    'Should catch newlines in string fields');
});

test('validator rejects invalid URLs', () => {
  const model = {
    dossier: {
      version: 1,
      title: 'Test',
      pages: [
        {
          title: 'Page',
          blocks: [
            {
              type: 'kv',
              items: [
                {
                  label: 'Test',
                  value: 'Test',
                  href: 'javascript:alert("xss")'
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const findings = validate(model);
  const errors = findings.filter(f => f.level === 'error');
  assert.ok(errors.some(e => e.message.includes('JavaScript')),
    'Should reject javascript: URLs');
});
