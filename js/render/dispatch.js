/**
 * Which module renders which block type.
 *
 * Each renderer module declares the types it handles and this file builds one
 * table from those declarations. Nothing here lists a type by hand.
 *
 * Two earlier versions of this both failed in the same quiet way. The first
 * was a switch over seven names with `a(block) || b(block) || c(block)` behind
 * it, so a new type was answered by whichever module happened to respond and a
 * block that legitimately rendered an empty string fell through to the wrong
 * renderer. The second routed on the registry's `group`, which reads well
 * until a group and a module disagree: `findings` and `tests` sit in the Work
 * group because that is where a reader looks for them in the catalog, and
 * they live in results.js, so every findings block was handed to the work
 * renderer and rendered as "no content provided".
 *
 * A type is a type. Routing on it cannot drift from where the code is, and
 * `missingRenderers()` names any registry type nobody claims.
 */

import { blockTypes } from '../registry/index.js';
import { renderNarrativeBlock, NARRATIVE_TYPES } from './narrative.js';
import { renderMeasurementBlock, MEASUREMENT_TYPES } from './measurement.js';
import { renderWorkBlock, WORK_TYPES } from './work.js';
import { renderResultsBlock, RESULTS_TYPES } from './results.js';
import { renderJudgmentBlock, JUDGMENT_TYPES } from './judgment.js';

const MODULES = [
  { types: NARRATIVE_TYPES, render: renderNarrativeBlock, name: 'narrative' },
  { types: MEASUREMENT_TYPES, render: renderMeasurementBlock, name: 'measurement' },
  { types: WORK_TYPES, render: renderWorkBlock, name: 'work' },
  { types: RESULTS_TYPES, render: renderResultsBlock, name: 'results' },
  { types: JUDGMENT_TYPES, render: renderJudgmentBlock, name: 'judgment' },
];

const BY_TYPE = new Map();
const CLASHES = [];

for (const mod of MODULES) {
  for (const type of mod.types || []) {
    if (BY_TYPE.has(type)) {
      CLASHES.push(`${type} is claimed by both ${BY_TYPE.get(type).name} and ${mod.name}`);
      continue;
    }
    BY_TYPE.set(type, mod);
  }
}

/** The renderer for a type, or null. */
export function rendererFor(type) {
  const mod = BY_TYPE.get(String(type || ''));
  return mod ? mod.render : null;
}

export function renderBlock(block, ctx) {
  const render = rendererFor(block && block.type);
  if (!render) return null;  // index.js owns the unknown-type card
  return render(block, ctx);
}

/**
 * Registry types nobody renders, and types two modules both claim. The test
 * suite asserts both are empty, which is the check that catches a block type
 * added to the registry and forgotten here.
 */
export function missingRenderers() {
  return blockTypes().filter((t) => !BY_TYPE.has(t));
}

export function rendererClashes() {
  return [...CLASHES];
}
