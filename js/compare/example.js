/**
 * The bundled illustrative comparison in `reports/compare/`: one incident
 * written three ways (a human draft in HTML with its own styling, an agent's
 * Markdown output, and a fixed version in HTML), described by
 * `reports/compare/index.json`.
 *
 * Opened as an unsaved set: it is saved, as a set of the visitor's own, only
 * once something in it is changed.
 */

import { newSet, addColumn, setView, ROLES } from './model.js';
import { readSource } from './sources.js';

const BASE = 'reports/compare/';
const FILE = /^[a-z0-9][a-z0-9-]*\.(html|md|txt|json)$/;

async function fetchText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.text();
}

/**
 * @returns {Promise<{ok: true, set: object} | {ok: false, message: string}>}
 */
export async function loadExample() {
  let index;
  try {
    index = JSON.parse(await fetchText(`${BASE}index.json`));
  } catch {
    return { ok: false, message: 'The example comparison could not be loaded. Reload the page to try again.' };
  }
  const columns = Array.isArray(index.columns) ? index.columns.slice(0, 4) : [];
  let set = newSet({ title: index.title || 'Illustrative example' });
  const ids = [];
  for (const spec of columns) {
    if (!spec || !FILE.test(String(spec.file || ''))) return { ok: false, message: 'The example comparison names a file it should not.' };
    let text;
    try {
      text = await fetchText(`${BASE}${spec.file}`);
    } catch {
      return { ok: false, message: `The example file ${spec.file} could not be loaded.` };
    }
    const read = await readSource(text, spec.file);
    if (!read.ok || !read.source) return { ok: false, message: `The example file ${spec.file} could not be read.` };
    const fixes = Number.isInteger(spec.fixes) ? ids[spec.fixes] : undefined;
    const added = addColumn(set, {
      role: ROLES.includes(spec.role) ? spec.role : 'other',
      label: spec.label,
      author: spec.author,
      fixes,
      source: read.source,
    });
    set = added.set;
    ids.push(added.id);
  }
  if (typeof index.prompt === 'string') set = { ...set, prompt: index.prompt.slice(0, 4000) };
  set = setView(set, { focus: ids[ids.length - 1] || null });
  return { ok: true, set };
}

/**
 * The card that opens the example, for the welcome screen and the Open
 * dialog's Examples list. Same shape as the report example cards
 * (js/catalog.js), so both lists style it the same.
 *
 * @returns {HTMLLIElement}
 */
export function exampleCard() {
  const li = document.createElement('li');
  li.className = 'ds-examples__compare';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-example ds-example--compare';
  button.dataset.action = 'cmp-example';
  const title = document.createElement('span');
  title.className = 'ds-example__title';
  title.textContent = 'Example comparison: human, agent and fixes';
  const summary = document.createElement('span');
  summary.className = 'ds-example__summary';
  summary.textContent = 'One incident report written three ways, side by side in the Compare view.';
  const meta = document.createElement('span');
  meta.className = 'ds-example__meta';
  meta.textContent = 'Illustrative example, 3 columns';
  button.append(title, summary, meta);
  li.append(button);
  return li;
}
