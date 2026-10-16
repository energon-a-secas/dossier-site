/**
 * Ids built from document data, for markup the renderer writes.
 *
 * A block id reaches SVG `<defs>` ids and gradient references through the Viz
 * Kit, which interpolates them raw. The parser derives ids from titles, so a
 * parsed document is safe, but `blockHtml` is also called on blocks straight
 * from a file (the catalog, a comparison column). Anything outside
 * [A-Za-z0-9_-] is dropped, so an id can never close its attribute.
 *
 * DOM-free. Node imports this.
 */
export function safeDomId(value, fallback = 'x') {
  const id = String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  return id || fallback;
}
