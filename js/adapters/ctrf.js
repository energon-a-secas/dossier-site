/**
 * CTRF adapter: parse CTRF test reports
 *
 * Reads results array and tool information. Carries CTRF extra through
 * into dossier extra.
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

  if (!obj.results || !Array.isArray(obj.results)) {
    findings.push({
      level: 'warn',
      message: 'CTRF has no results array',
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

  for (const result of obj.results) {
    const state = result.status === 'FAILED' ? 'failed' : result.status === 'PASSED' ? 'passed' : 'skipped';

    if (state === 'passed') passCount++;
    if (state === 'failed') failCount++;
    if (state === 'skipped') skipCount++;

    items.push({
      name: result.name || 'test',
      state,
      detail: result.message,
    });
  }

  const toolName = obj.results?.tool?.name || 'CTRF tool';

  const extra = {};
  if (obj.extra) {
    Object.assign(extra, obj.extra);
  }

  const document = {
    dossier: {
      version: 1,
      title: `${toolName} results`,
      pages: [
        {
          title: 'Tests',
          blocks: [
            {
              type: 'tests',
              title: 'Test run',
              items,
              extra,
            },
            {
              type: 'metrics',
              title: 'Summary',
              items: [
                { label: 'Total', value: items.length, unit: 'tests' },
                { label: 'Passed', value: passCount, unit: 'tests', tone: 'good' },
                { label: 'Failed', value: failCount, unit: 'tests', tone: failCount > 0 ? 'bad' : 'neutral' },
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
