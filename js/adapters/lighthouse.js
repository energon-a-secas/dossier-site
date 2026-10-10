/**
 * Lighthouse adapter: parse Lighthouse LHR JSON
 *
 * Reads categories into a metrics block with each score as a percentage,
 * and failed audits into findings.
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

  if (!obj.categories) {
    findings.push({
      level: 'warn',
      message: 'Lighthouse report has no categories',
      path: '',
      page: null,
      rule: null,
    });
    return { document: null, findings };
  }

  const metrics = [];
  for (const [key, cat] of Object.entries(obj.categories || {})) {
    if (cat.score !== undefined) {
      const pct = Math.round(cat.score * 100);
      metrics.push({
        label: cat.title || key,
        value: pct,
        unit: '%',
        baseline: 90,
        better: 'higher',
      });
    }
  }

  const failedFindings = [];
  if (obj.audits) {
    for (const [key, audit] of Object.entries(obj.audits)) {
      if (audit.score !== undefined && audit.score < 1 && audit.details?.type === 'opportunity') {
        failedFindings.push({
          rule: key,
          level: 'warn',
          message: audit.title || key,
          path: '',
        });
      }
    }
  }

  const blocks = [];

  if (metrics.length > 0) {
    blocks.push({
      type: 'metrics',
      title: 'Scores',
      items: metrics,
    });
  }

  if (failedFindings.length > 0) {
    blocks.push({
      type: 'findings',
      title: 'Opportunities',
      items: failedFindings,
    });
  }

  const document = {
    dossier: {
      version: 1,
      title: 'Lighthouse report',
      pages: [{
        title: 'Results',
        blocks: blocks.length > 0 ? blocks : [{
          type: 'prose',
          text: 'No data to report',
        }],
      }],
    },
  };

  return { document, findings };
}
