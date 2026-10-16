/**
 * JUnit adapter: parse JUnit-style XML test results
 *
 * Reads only the stable subset: testsuite/@tests|@failures|@errors|@skipped|@time
 * and testcase/@name|@classname|@time, plus failure/error/skipped child.
 *
 * No external dependencies. Hand-rolled regex-free tag walker.
 *
 * The failure output goes in `message`, the field the tests block declares and
 * renders. It used to go in `detail`, which the format does not have, so a
 * failed test showed no output and the linter asked for a message that was
 * sitting in the document under the wrong name.
 *
 * Pure, DOM-free.
 */

/** The longest failure output the tests block accepts. */
const MESSAGE_MAX = 2000;

/**
 * @param {string} source
 * @returns {{ document: Document|null, findings: Array }}
 */
export function toDossier(source) {
  const findings = [];

  if (!source || typeof source !== 'string') {
    return { document: null, findings };
  }

  const suiteAttrs = parseJunitAttrs(source.match(/<testsuite[^>]*>/)?.[0] || '');

  const items = [];
  let pos = 0;

  while (true) {
    const caseStartIdx = source.indexOf('<testcase', pos);
    if (caseStartIdx === -1) break;

    const openTagEnd = source.indexOf('>', caseStartIdx);
    const openTag = source.substring(caseStartIdx, openTagEnd + 1);
    const attrs = parseJunitAttrs(openTag);
    const name = attrs.name || 'unknown';
    const classname = attrs.classname || '';
    const caseName = classname ? `${classname}.${name}` : name;

    let state = 'passed';
    let message = '';
    let nextPos = openTagEnd + 1;

    if (openTag.endsWith('/>')) {
      pos = nextPos;
    } else {
      const caseEndIdx = source.indexOf('</testcase>', nextPos);
      if (caseEndIdx === -1) {
        pos = nextPos;
      } else {
        const caseContent = source.substring(nextPos, caseEndIdx);

        if (/<failure/i.test(caseContent)) {
          state = 'failed';
          message = failureText(caseContent, 'failure');
        } else if (/<error/i.test(caseContent)) {
          // The format's word is "errored"; "error" is not one of its states.
          state = 'errored';
          message = failureText(caseContent, 'error');
        } else if (/<skipped/i.test(caseContent)) {
          state = 'skipped';
          message = failureText(caseContent, 'skipped');
        }

        pos = caseEndIdx + 11;
      }
    }

    const item = { name: caseName, state };
    const seconds = parseFloat(attrs.time);
    if (Number.isFinite(seconds)) item.duration = seconds;
    if (message) item.message = message.substring(0, MESSAGE_MAX);
    items.push(item);
  }

  const testCount = parseInt(suiteAttrs.tests || items.length, 10);
  const failureCount = parseInt(suiteAttrs.failures || 0, 10);
  const errorCount = parseInt(suiteAttrs.errors || 0, 10);
  const skippedCount = parseInt(suiteAttrs.skipped || 0, 10);

  const document = {
    dossier: {
      version: 1,
      title: 'Test results',
      pages: [
        {
          title: 'Tests',
          blocks: [
            testsBlock(items, suiteAttrs),
            {
              // Metric items have no tone of their own; the block's tone is
              // the envelope's, and one colour for five numbers says nothing.
              type: 'metrics',
              title: 'Summary',
              items: [
                { label: 'Total', value: testCount, unit: 'tests' },
                { label: 'Passed', value: testCount - failureCount - errorCount - skippedCount, unit: 'tests' },
                { label: 'Failed', value: failureCount, unit: 'tests', better: 'lower' },
                { label: 'Errors', value: errorCount, unit: 'tests', better: 'lower' },
                { label: 'Skipped', value: skippedCount, unit: 'tests' },
              ],
            },
          ],
        },
      ],
    },
  };

  return { document, findings };
}

function testsBlock(items, suiteAttrs) {
  const block = { type: 'tests', title: 'Test run', items };
  if (suiteAttrs.name) block.suite = suiteAttrs.name.substring(0, 120);
  const seconds = parseFloat(suiteAttrs.time);
  if (Number.isFinite(seconds)) block.duration = seconds;
  return block;
}

/**
 * The output of a <failure>, <error> or <skipped> child: its body when it has
 * one, else its message attribute, which is all a self-closing tag carries.
 */
function failureText(content, tag) {
  const open = content.match(new RegExp(`<${tag}\\b[^>]*>`, 'i'));
  if (!open) return '';
  const body = content.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  const text = body ? xmlText(body[1]).trim() : '';
  return text || parseJunitAttrs(open[0]).message || '';
}

/** Element text: entities decoded, CDATA sections kept exactly as written. */
function xmlText(raw) {
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeXml(raw.slice(last, m.index)) + m[1];
    last = m.index + m[0].length;
  }
  return out + decodeXml(raw.slice(last));
}

function parseJunitAttrs(tag) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(tag)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

/** The five XML entities and numeric references. The renderer escapes again. */
function decodeXml(value) {
  const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, ref) => {
    if (ref[0] !== '#') return named[ref.toLowerCase()] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

