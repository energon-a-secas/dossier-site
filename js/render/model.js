/**
 * One tolerant seam over the two shapes a report arrives in.
 *
 * js/parse.js returns the wrapped document `{dossier: {...}}` and
 * js/validate.js checks that shape, so its finding paths read
 * `dossier.pages[0].blocks[2]`. The renderer only cares about the report
 * inside. The frozen contract did not say which one a "model" was, so the
 * parser kept the wrapper, the renderer did not expect it, and js/export.js
 * reached past it for the title while handing the wrapped object to
 * renderReport, which rendered "No pages in model" on every export.
 *
 * This lives in its own module rather than in index.js so that outline.js can
 * use it without importing index.js, which imports outline.js.
 */
export function reportOf(model) {
  if (!model || typeof model !== 'object') return null;
  return model.dossier && typeof model.dossier === 'object' ? model.dossier : model;
}
