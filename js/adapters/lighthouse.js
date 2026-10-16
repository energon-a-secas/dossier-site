/**
 * Lighthouse adapter: parse Lighthouse LHR JSON
 *
 * Reads categories into a metrics block with each score as a percentage,
 * and failed audits into findings.
 *
 * Levels are the findings block's own words (error, warning, note). This used
 * to write "warn", which the format does not have, so every opportunity was a
 * validation error and rendered at the fallback level. The 90 every score is
 * held against is Lighthouse's "good" threshold, so it is the metric's target,
 * not a baseline: a baseline is what the number was before, and calling 90
 * that made the page report a change nobody measured.
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
    if (typeof cat?.score === 'number' && Number.isFinite(cat.score)) {
      const pct = Math.round(cat.score * 100);
      metrics.push({
        label: String(cat.title || key).substring(0, 40),
        value: pct,
        unit: '%',
        target: 90,
        better: 'higher',
      });
    }
  }

  const failedFindings = [];
  if (obj.audits) {
    for (const [key, audit] of Object.entries(obj.audits)) {
      // A null score is an informative or manual audit, not a failed one.
      if (typeof audit?.score === 'number' && audit.score < 1 && audit.details?.type === 'opportunity') {
        const finding = {
          rule: String(key).substring(0, 80),
          level: 'warning',
          message: String(audit.title || key).substring(0, 400),
        };
        if (typeof audit.displayValue === 'string' && audit.displayValue) finding.detail = audit.displayValue.substring(0, 1200);
        failedFindings.push(finding);
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
