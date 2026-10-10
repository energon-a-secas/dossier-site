/**
 * SARIF adapter: parse SARIF 2.1.0 findings
 *
 * Reads runs[].results[] for ruleId, level, message.text and the first
 * locations[].physicalLocation for path and region.startLine.
 *
 * Emits a findings block.
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

  if (!obj.runs || !Array.isArray(obj.runs)) {
    findings.push({
      level: 'warn',
      message: 'SARIF has no runs array',
      path: '',
      page: null,
      rule: null,
    });
    return { document: null, findings };
  }

  const items = [];
  for (const run of obj.runs) {
    if (!run.results || !Array.isArray(run.results)) continue;

    for (const result of run.results) {
      const ruleId = result.ruleId || 'rule';
      const level = result.level || 'warning';
      const message = result.message?.text || '(no message)';

      let path = '';
      let line = undefined;

      if (result.locations && Array.isArray(result.locations) && result.locations.length > 0) {
        const loc = result.locations[0];
        if (loc.physicalLocation) {
          path = loc.physicalLocation.artifactLocation?.uri || '';
          if (loc.physicalLocation.region) {
            line = loc.physicalLocation.region.startLine;
          }
        }
      }

      items.push({
        rule: ruleId,
        level: level === 'none' ? 'info' : level,
        message,
        path,
        line,
      });
    }
  }

  const document = {
    dossier: {
      version: 1,
      title: 'SARIF findings',
      pages: [
        {
          title: 'Results',
          blocks: [
            {
              type: 'findings',
              title: 'Findings',
              items,
            },
          ],
        },
      ],
    },
  };

  return { document, findings };
}
