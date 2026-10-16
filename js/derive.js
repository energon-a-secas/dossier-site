/**
 * Derivation: compute fields the renderer cannot compute.
 *
 * Pure and idempotent. Re-applicable by tests and by re-parsing. The renderer
 * never computes: delta, deltaPct, direction, totals, counts, stats, max ceiling,
 * slugged id. Those are the only facts a model can derive.
 *
 * The reporter is a human, the renderer is untrusted code. A number that looks
 * measured is measured. A number in a report about correctness that is wrong is
 * the single worst defect this product can ship.
 *
 * DOM-free. Node imports this.
 */

import { blockDef } from './registry/index.js';

/**
 * Derive and nothing else: metric delta/deltaPct from baseline, metric direction
 * from delta and better, block and page id from title, files.totals, checklist.done,
 * scorecard.passed, diff.stats from patch, log.lines, chart.max to a round ceiling.
 *
 * @param {object} model
 * @returns {undefined}
 *
 * Mutates the model in place. Pure in the mathematical sense: same input always
 * produces the same mutations, no side effects beyond the model.
 */
/**
 * Record that this object's field was computed here, not written by the author.
 *
 * Without this, a derived model is indistinguishable from a document whose
 * author supplied a number the renderer was going to compute anyway, and the
 * check that catches the second one fires on the first. The marker is
 * non-enumerable, so JSON.stringify, the renderer and every export ignore it,
 * and a round trip through a file drops it, which is correct: a file has no
 * derived fields, only authored ones.
 */
export function markDerived(obj, field) {
  if (!obj || typeof obj !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(obj, '__derived')) {
    Object.defineProperty(obj, '__derived', {
      value: [],
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  if (!obj.__derived.includes(field)) obj.__derived.push(field);
}

/** True when this field was computed rather than written by the author. */
export function wasDerived(obj, field) {
  return Boolean(obj && Array.isArray(obj.__derived) && obj.__derived.includes(field));
}

export function derive(model) {
  if (!model?.dossier) return;

  const dossier = model.dossier;

  derivePageIds(dossier);
  deriveBlockIds(dossier);

  if (dossier.pages && Array.isArray(dossier.pages)) {
    for (const page of dossier.pages) {
      if (page?.blocks && Array.isArray(page.blocks)) {
        for (const block of page.blocks) {
          deriveBlock(block);
        }
      }
    }
  }
}

/**
 * A page id is its route, `#/<id>`, so it has to be unique and routable.
 *
 * Two pages titled "Notes" both became `notes`, and the second one could never
 * be opened. A title with no Latin letters or digits ("日本語", "???") slugged to
 * an empty string, which is no route at all. Now a repeat gets a number
 * (`notes`, `notes-2`), an empty slug becomes `page-<n>`, and nothing starts
 * with `~`, which the router keeps for its own views (`#/~compare`). An id the
 * author supplied is left alone, and a derived one never collides with it.
 */
function derivePageIds(dossier) {
  if (!dossier.pages || !Array.isArray(dossier.pages)) return;

  const taken = new Set();
  for (const page of dossier.pages) {
    if (page && page.id) taken.add(String(page.id));
  }

  dossier.pages.forEach((page, index) => {
    if (!page || typeof page !== 'object' || page.id) return;
    // slugId keeps only [a-z0-9_-], so a derived id can never start with "~".
    const base = slugId(page.title) || `page-${index + 1}`;
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    page.id = id;
    markDerived(page, 'id');
  });
}

function deriveBlockIds(dossier) {
  if (!dossier.pages || !Array.isArray(dossier.pages)) return;

  const seen = new Set();

  for (let pi = 0; pi < dossier.pages.length; pi++) {
    const page = dossier.pages[pi];
    if (page?.blocks && Array.isArray(page.blocks)) {
      for (let bi = 0; bi < page.blocks.length; bi++) {
        const block = page.blocks[bi];
        if (!block.id) {
          let id = slugId(block.title);
          if (!id) id = `block-p${pi}b${bi}`;
          if (seen.has(id)) {
            let counter = 1;
            let newId = `${id}-${counter}`;
            while (seen.has(newId)) {
              counter++;
              newId = `${id}-${counter}`;
            }
            id = newId;
          }
          block.id = id;
          markDerived(block, 'id');
          seen.add(id);
        } else {
          seen.add(block.id);
        }
      }
    }
  }
}

function deriveBlock(block) {
  if (!block) return;

  const type = block.type;
  const def = blockDef(type);

  if (type === 'metrics' && block.items && Array.isArray(block.items)) {
    for (const item of block.items) {
      deriveMetric(item);
    }
  }

  if (type === 'scorecard' && block.criteria && Array.isArray(block.criteria)) {
    let passed = 0;
    for (const criterion of block.criteria) {
      if (criterion?.verdict === 'pass') passed++;
    }
    block.passed = passed;
    markDerived(block, 'passed');
  }

  if (type === 'files' && block.items && Array.isArray(block.items)) {
    block.totals = deriveFilesTotals(block.items);
    markDerived(block, 'totals');
  }

  if (type === 'diff' && block.patch) {
    block.stats = deriveDiffStats(block.patch);
    markDerived(block, 'stats');
  }

  if (type === 'log' && block.source) {
    block.lines = (block.source.match(/\n/g) || []).length + 1;
    markDerived(block, 'lines');
  }

  if (type === 'chart') {
    deriveChartMax(block);
  }

  if (type === 'checklist' && block.items && Array.isArray(block.items)) {
    let done = 0;
    for (const item of block.items) {
      if (item?.state === 'done') done++;
    }
    block.done = done;
    markDerived(block, 'done');
  }
}

function deriveMetric(metric) {
  if (metric.value === undefined || metric.value === null) return;

  if (metric.baseline !== undefined && metric.baseline !== null) {
    const delta = metric.value - metric.baseline;
    metric.delta = delta;
    markDerived(metric, 'delta');

    if (metric.baseline === 0) {
      metric.deltaPct = undefined;
      markDerived(metric, 'deltaPct');
    } else {
      const pct = (delta / Math.abs(metric.baseline)) * 100;
      metric.deltaPct = Math.round(pct * 100) / 100;
      markDerived(metric, 'deltaPct');
    }

    const better = metric.better || 'higher';
    if (better === 'lower') {
      metric.direction = delta < 0 ? 'good' : delta > 0 ? 'bad' : 'neutral';
      markDerived(metric, 'direction');
    } else if (better === 'higher') {
      metric.direction = delta > 0 ? 'good' : delta < 0 ? 'bad' : 'neutral';
      markDerived(metric, 'direction');
    } else {
      metric.direction = 'neutral';
      markDerived(metric, 'direction');
    }
  }
}

function deriveFilesTotals(items) {
  const totals = {
    count: 0,
    added: 0,
    removed: 0,
  };

  for (const item of items) {
    if (!item) continue;
    totals.count++;
    if (item.added !== undefined && item.added !== null) {
      totals.added += item.added;
    }
    if (item.removed !== undefined && item.removed !== null) {
      totals.removed += item.removed;
    }
  }

  return totals;
}

function deriveDiffStats(patch) {
  let added = 0;
  let removed = 0;

  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed++;
    }
  }

  return { added, removed };
}

function deriveChartMax(block) {
  if (block.max !== undefined) return;

  let max = 0;

  if (block.series && Array.isArray(block.series)) {
    for (const s of block.series) {
      if (s?.values && Array.isArray(s.values)) {
        for (const v of s.values) {
          const n = Number(v);
          if (!isNaN(n) && n > max) {
            max = n;
          }
        }
      }
    }
  }

  if (block.grid && Array.isArray(block.grid)) {
    for (const row of block.grid) {
      if (Array.isArray(row)) {
        for (const v of row) {
          const n = Number(v);
          if (!isNaN(n) && n > max) {
            max = n;
          }
        }
      }
    }
  }

  if (max > 0) {
    block.max = roundCeiling(max);
    markDerived(block, 'max');
  }
}

function roundCeiling(value) {
  if (value <= 0) return 1;

  const magnitude = Math.floor(Math.log10(value));
  const base = Math.pow(10, magnitude);
  const normalized = value / base;

  let step;
  if (normalized <= 1) step = 1;
  else if (normalized <= 2) step = 2;
  else if (normalized <= 2.5) step = 2.5;
  else if (normalized <= 5) step = 5;
  else step = 10;

  return step * base;
}

function slugId(title) {
  if (!title || typeof title !== 'string') return '';

  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // "Résumé" keeps its letters as "resume"
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
