/**
 * The one owner of the URL hash.
 *
 * Four things share `location.hash`, and before this module each reader had
 * its own regular expression, so a page link could be mistaken for a failed
 * share link and a heading link wiped the page route:
 *
 *   #/<page id>             a page of the open report
 *   #/~compare              the Compare view, last or new set
 *   #/~compare/<set id>     one saved comparison
 *   #dz= #d1= #dc=          payloads (a report or a comparison inside the link)
 *
 * Derived page ids only ever contain `[a-z0-9_-]` (js/derive.js), so a segment
 * starting with `~` can never collide with a page. DOM-free: node imports it.
 */

export const COMPARE_SEGMENT = '~compare';

// `#v1:dz:` is the shape an early build emitted. Old links keep working.
const PAYLOAD = /^(dz|d1|dc)=/;
const LEGACY_PAYLOAD = /^v1:(dz|d1):/;

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Read a hash.
 *
 * @param {string} [hash] defaults to the current location
 * @returns {{view: 'reports', page?: string}
 *   | {view: 'compare', id?: string}
 *   | {anchor: string}
 *   | {payload: true, key: 'dz'|'d1'|'dc'}}
 *   `page` absent means page one. `anchor` is a bare `#name`: a place on the
 *   page already shown, which the browser scrolls to. It names no view and no
 *   page, so following it changes neither: the skip link pressed in the
 *   Compare view must not drop the reader back into Reports.
 */
export function parseRoute(hash = (typeof location === 'undefined' ? '' : location.hash)) {
  const raw = String(hash || '').replace(/^#/, '');

  const keyed = PAYLOAD.exec(raw) || LEGACY_PAYLOAD.exec(raw);
  if (keyed) return { payload: true, key: keyed[1] };

  if (!raw) return { view: 'reports' };
  // A bare `#<anchor>` (the skip link, an old outline heading link) is not a
  // route: it names a place on the current page, so it carries no view.
  if (!raw.startsWith('/')) {
    const anchor = decode(raw);
    return anchor ? { anchor } : { view: 'reports' };
  }

  const rest = raw.slice(1);
  const slash = rest.indexOf('/');
  const head = decode(slash === -1 ? rest : rest.slice(0, slash));
  if (head === COMPARE_SEGMENT) {
    const id = slash === -1 ? null : decode(rest.slice(slash + 1));
    return id ? { view: 'compare', id } : { view: 'compare' };
  }

  const page = decode(rest);
  return page ? { view: 'reports', page } : { view: 'reports' };
}

/**
 * Build a hash from a route. The inverse of parseRoute for every route that is
 * not a payload; payloads are built by js/share.js, which owns the codecs.
 *
 * @param {{view?: 'reports'|'compare', page?: string, id?: string}} [route]
 * @returns {string} a hash starting with `#/`
 */
export function routeFor(route = {}) {
  if (route.view === 'compare') {
    return route.id
      ? `#/${COMPARE_SEGMENT}/${encodeURIComponent(route.id)}`
      : `#/${COMPARE_SEGMENT}`;
  }
  return route.page ? `#/${encodeURIComponent(route.page)}` : '#/';
}

/** True when a hash carries a payload rather than naming a place. */
export function isPayload(hash) {
  return Boolean(parseRoute(hash).payload);
}

/** True when a hash is a bare in-page anchor, which keeps the current view. */
export function isAnchor(hash) {
  return Boolean(parseRoute(hash).anchor);
}
