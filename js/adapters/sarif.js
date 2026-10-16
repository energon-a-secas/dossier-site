/**
 * SARIF adapter: parse SARIF 2.1.0 findings
 *
 * Reads runs[].results[] for ruleId, level, message.text and the first
 * locations[].physicalLocation for path and region.startLine.
 *
 * Emits a findings block. SARIF's own levels are error, warning, note and
 * none; the first three are the findings block's words too, and none (a
 * result that is not a problem) becomes note. It used to become "info", which
 * the format does not have.
 *
 * Pure, DOM-free.
 */

const LEVELS = ['error', 'warning', 'note'];

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
      const ruleId = String(result.ruleId || 'rule');
      const level = LEVELS.includes(result.level) ? result.level : result.level === 'none' ? 'note' : 'warning';
      const message = String(result.message?.text || result.message?.markdown || '(no message)');

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

      const item = { rule: ruleId.substring(0, 80), level, message };
      // A message past the field's limit keeps its first part as the message
      // and the whole text as the detail, rather than failing validation.
      if (message.length > 400) {
        item.message = `${message.substring(0, 399)}\u2026`;
        item.detail = message.substring(0, 1200);
      }
      if (path) item.path = String(path).substring(0, 240);
      if (Number.isInteger(line)) item.line = line;
      items.push(item);
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
