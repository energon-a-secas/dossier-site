/**
 * Validate every fixture and starter template against its own declared
 * expectation, read from the manifest rather than from a list in a Makefile.
 *
 * `fixtures/messy.json` must stay broken: it is the test corpus for the error
 * paths. So "validate everything in the directory" is the wrong rule, and
 * "validate these two files by name" drifts the moment a fixture is added.
 * The manifest already states what each file should produce, so that is what
 * this checks, in both directions: a clean fixture with a finding fails, and
 * a fixture declared broken that validates clean fails too.
 *
 * Exit 0 clean, 1 findings, 2 could not run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../js/validate.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readManifest(dir) {
  const file = path.join(root, dir, 'index.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`  ${dir}/index.json is not readable JSON: ${err.message}`);
    return undefined;
  }
}

let failed = 0;
let checked = 0;

for (const dir of ['fixtures', 'reports']) {
  const manifest = readManifest(dir);
  if (manifest === null) continue;
  if (manifest === undefined) process.exit(2);

  const entries = Array.isArray(manifest) ? manifest : manifest.items || [];
  if (!entries.length) {
    console.error(`  ${dir}/index.json lists nothing, which is broken discovery rather than a clean tree`);
    process.exit(2);
  }

  for (const entry of entries) {
    const file = path.join(root, dir, entry.file);
    if (!fs.existsSync(file)) {
      console.error(`  ${dir}/${entry.file} is in the manifest and not on disk`);
      failed += 1;
      continue;
    }

    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.error(`  ${dir}/${entry.file} is not readable JSON: ${err.message}`);
      failed += 1;
      continue;
    }

    checked += 1;
    const findings = validate(doc);
    const serious = findings.filter((f) => f.level === 'error' || f.level === 'warn');
    const expectBroken = entry.findings === 'multiple' || Number(entry.findings) > 0;

    if (expectBroken) {
      if (!serious.length) {
        console.error(`  ${dir}/${entry.file} is declared broken and validates clean, so it has stopped testing anything`);
        failed += 1;
      } else {
        console.log(`  ok   ${dir}/${entry.file}: broken as declared, ${serious.length} finding(s)`);
      }
    } else if (serious.length) {
      console.error(`  FAIL ${dir}/${entry.file}: ${serious.length} finding(s), expected none`);
      for (const f of serious.slice(0, 8)) {
        console.error(`         [${f.level}] ${f.path}: ${f.message}`);
      }
      failed += 1;
    } else {
      console.log(`  ok   ${dir}/${entry.file}: clean`);
    }
  }
}

if (!checked) {
  console.error('  no fixture was checked');
  process.exit(2);
}
process.exit(failed ? 1 : 0);
