/**
 * JUnit adapter: parse JUnit-style XML test results
 *
 * Reads only the stable subset: testsuite/@tests|@failures|@errors|@skipped|@time
 * and testcase/@name|@classname|@time, plus failure/error/skipped child.
 *
 * No external dependencies. Hand-rolled regex-free tag walker.
 *
 * Pure, DOM-free.
 */

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
    let detail = '';
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
          const detailMatch = caseContent.match(/<failure[^>]*>([\s\S]*?)<\/failure>/i);
          detail = detailMatch ? detailMatch[1].trim() : '';
        } else if (/<error/i.test(caseContent)) {
          state = 'error';
          const detailMatch = caseContent.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
          detail = detailMatch ? detailMatch[1].trim() : '';
        } else if (/<skipped/i.test(caseContent)) {
          state = 'skipped';
        }

        pos = caseEndIdx + 11;
      }
    }

    items.push({
      name: caseName,
      state,
      detail: detail ? detail.substring(0, 400) : undefined,
    });
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
            {
              type: 'tests',
              title: 'Test run',
              items,
            },
            {
              type: 'metrics',
              title: 'Summary',
              items: [
                { label: 'Total', value: testCount, unit: 'tests' },
                { label: 'Passed', value: testCount - failureCount - errorCount - skippedCount, unit: 'tests', tone: 'good' },
                { label: 'Failed', value: failureCount, unit: 'tests', tone: failureCount > 0 ? 'bad' : 'neutral' },
                { label: 'Errors', value: errorCount, unit: 'tests', tone: errorCount > 0 ? 'bad' : 'neutral' },
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

function parseJunitAttrs(tag) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(tag)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

