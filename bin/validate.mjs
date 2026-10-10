#!/usr/bin/env node

/**
 * CLI validator: node bin/validate.mjs <file.json> [...]
 *
 * Exit codes: 0 clean, 1 findings, 2 could not run.
 * No dependencies.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validate } from '../js/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse arguments
let quiet = false;
let asJson = false;
let maxLevel = 'warn';
const files = [];

for (const arg of process.argv.slice(2)) {
  if (arg === '--quiet') {
    quiet = true;
  } else if (arg === '--json') {
    asJson = true;
  } else if (arg.startsWith('--max-level=')) {
    maxLevel = arg.split('=')[1];
  } else {
    files.push(arg);
  }
}

if (files.length === 0) {
  console.error('Usage: validate.mjs <file.json> [...] [--quiet] [--json] [--max-level=warn|info|error]');
  process.exit(2);
}

const levelPriority = { error: 3, warn: 2, info: 1 };
const maxLevelPriority = levelPriority[maxLevel] || 2;

let totalFindings = [];
let hadErrors = false;
let couldNotRun = false;

// Expand directories and collect JSON files
const toProcess = [];
for (const file of files) {
  try {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(file);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          toProcess.push(path.join(file, entry));
        }
      }
    } else {
      toProcess.push(file);
    }
  } catch (e) {
    if (!quiet) {
      console.error(`Cannot read ${file}: ${e.message}`);
    }
    couldNotRun = true;
  }
}

// Process each file
for (const file of toProcess) {
  let json;
  try {
    const content = fs.readFileSync(file, 'utf-8');
    json = JSON.parse(content);
  } catch (e) {
    if (e instanceof SyntaxError) {
      if (asJson) {
        console.log(JSON.stringify({
          file,
          level: 'error',
          message: `JSON syntax error: ${e.message}`,
          position: e.message,
        }));
      } else if (!quiet) {
        console.error(`${file}: JSON syntax error at ${e.message}`);
      }
      couldNotRun = true;
    } else {
      if (!quiet) {
        console.error(`Cannot read ${file}: ${e.message}`);
      }
      couldNotRun = true;
    }
    continue;
  }

  // Validate
  let findings = [];
  try {
    findings = validate(json);
  } catch (e) {
    if (asJson) {
      console.log(JSON.stringify({
        file,
        level: 'error',
        message: `Validation error: ${e.message}`,
      }));
    } else if (!quiet) {
      console.error(`${file}: Validation error: ${e.message}`);
    }
    couldNotRun = true;
    continue;
  }

  // Filter by level
  const filtered = findings.filter(f => levelPriority[f.level] >= maxLevelPriority);

  if (filtered.length > 0) {
    hadErrors = true;
  }

  if (asJson) {
    for (const finding of filtered) {
      console.log(JSON.stringify({ file, ...finding }));
    }
  } else if (!quiet) {
    // Group by page
    const byPage = {};
    for (const f of filtered) {
      const pageName = f.page || '(document)';
      if (!byPage[pageName]) byPage[pageName] = [];
      byPage[pageName].push(f);
    }

    if (Object.keys(byPage).length > 0) {
      console.log(`\n${file}:`);
      for (const [pageName, pageFindings] of Object.entries(byPage)) {
        if (pageFindings.length > 0) {
          console.log(`  ${pageName}:`);
          for (const f of pageFindings) {
            const ruleStr = f.rule ? ` (${f.rule})` : '';
            console.log(`    [${f.level.toUpperCase()}] ${f.path}: ${f.message}${ruleStr}`);
          }
        }
      }
    }
  }

  totalFindings = totalFindings.concat(filtered);
}

// Summary
if (!quiet) {
  const errorCount = totalFindings.filter(f => f.level === 'error').length;
  const warnCount = totalFindings.filter(f => f.level === 'warn').length;
  const infoCount = totalFindings.filter(f => f.level === 'info').length;

  if (totalFindings.length > 0) {
    console.log(`\nTotal: ${errorCount} error${errorCount === 1 ? '' : 's'}, ${warnCount} warn${warnCount === 1 ? '' : 's'}, ${infoCount} info`);
  }
}

// Exit
if (couldNotRun) {
  process.exit(2);
} else if (hadErrors) {
  process.exit(1);
} else {
  process.exit(0);
}
