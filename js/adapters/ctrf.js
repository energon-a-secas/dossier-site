/**
 * CTRF adapter: parse CTRF test reports
 *
 * The CTRF shape is `{ results: { tool, summary, tests: [...] } }`, with
 * lowercase statuses (passed, failed, skipped, pending, other) and durations
 * in milliseconds. Some tools write the test list straight into `results` as
 * an array instead, so both are read. CTRF `extra` is carried through into
 * the tests block's `extra`.
 *
 * The failure output goes in `message`, the field the tests block renders. It
 * used to go in `detail`, which the format does not have, and the detection
 * looked for `results.tool` while this function read `results` as an array, so
 * no CTRF file could reach it from the Open dialog.
 *
 * Pure, DOM-free.
 */

/** The longest failure output the tests block accepts. */
const MESSAGE_MAX = 2000;

/**
 * The test list of a parsed CTRF report, or null when it is not one.
 * Shared with the detector in ./index.js so the two cannot disagree.
 */
export function ctrfTests(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const results = obj.results;
  if (results && typeof results === 'object' && !Array.isArray(results)) {
    if (Array.isArray(results.tests)) return results.tests;
    return null;
  }
  if (Array.isArray(results) && results.length
    && results.every((r) => r && typeof r === 'object' && typeof r.name === 'string' && typeof r.status === 'string')) {
    return results;
  }
  return null;
}

/**
 * @param {string} source
 * @returns {{ document: Document|null, findings: Array }}
 */
export function toDossier(source) {
  const findings = [];

  if (!source || typeof source !== 'string') {
    return { document: null, findings };
  }

  let obj;
  try {
    obj = JSON.parse(source);
  } catch (e) {
    findings.push({
      level: 'error',
      message: `JSON parse error: ${e.message}`,
      path: '',
      page: null,
      rule: null,
    });
    return { document: null, findings };
  }

  const tests = ctrfTests(obj);
  if (!tests) {
    findings.push({
      level: 'warn',
      message: 'CTRF has no test list: expected results.tests',
      path: '',
      page: null,
      rule: null,
    });
    return { document: null, findings };
  }

  const items = [];
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const result of tests) {
    if (!result || typeof result !== 'object') continue;
    const state = stateOf(result);

    if (state === 'passed' || state === 'flaky') passCount++;
    if (state === 'failed' || state === 'errored') failCount++;
    if (state === 'skipped') skipCount++;

    const item = { name: String(result.name || 'test').substring(0, 240), state };
    // CTRF durations are milliseconds; the tests block counts seconds.
    const ms = Number(result.duration);
    if (result.duration !== undefined && result.duration !== null && Number.isFinite(ms)) item.duration = ms / 1000;
    if (typeof result.suite === 'string' && result.suite) item.suite = result.suite.substring(0, 120);
    const message = [result.message, result.trace].filter((v) => typeof v === 'string' && v.trim()).join('\n\n');
    if (message) item.message = message.substring(0, MESSAGE_MAX);
    items.push(item);
  }

  const tool = !Array.isArray(obj.results) ? obj.results?.tool : obj.tool;
  const toolName = typeof tool?.name === 'string' && tool.name ? tool.name : 'CTRF tool';

  const block = { type: 'tests', title: 'Test run', items };
  if (obj.extra && typeof obj.extra === 'object' && !Array.isArray(obj.extra) && Object.keys(obj.extra).length) {
    block.extra = { ...obj.extra };
  }

  const document = {
    dossier: {
      version: 1,
      title: `${toolName} results`.substring(0, 120),
      pages: [
        {
          title: 'Tests',
          blocks: [
            block,
            {
              type: 'metrics',
              title: 'Summary',
              items: [
                { label: 'Total', value: items.length, unit: 'tests' },
                { label: 'Passed', value: passCount, unit: 'tests' },
                { label: 'Failed', value: failCount, unit: 'tests', better: 'lower' },
                { label: 'Skipped', value: skipCount, unit: 'tests' },
              ],
            },
          ],
        },
      ],
    },
  };

  return { document, findings };
}

/** A CTRF status in the tests block's own words. */
function stateOf(result) {
  const status = String(result.status || '').toLowerCase();
  if (status === 'passed') return result.flaky === true ? 'flaky' : 'passed';
  if (status === 'failed') return 'failed';
  // pending and other are not run results; skipped is the nearest honest word.
  return 'skipped';
}
