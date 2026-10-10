/**
 * URL safety for rendered links.
 *
 * Everything this product renders is untrusted. A report arrives from a file
 * someone was given, from a fragment in a link, or from an agent, and it is
 * then rendered into a page that holds the reader's other reports. So a URL in
 * a document is attacker-controlled input, not configuration.
 *
 * The defect this exists to close was live: the markdown link rule inserted
 * its target straight into an href after HTML-escaping it, which escapes the
 * quotes and leaves the scheme intact, so `[click](javascript:alert(1))` in a
 * prose block rendered a working javascript: link. Escaping is not scheme
 * checking, and the two get confused because escaping looks like it did the
 * job.
 *
 * An allowlist, not a blocklist: `javascript:` has many spellings, with tabs,
 * newlines and entities inside it, and a blocklist loses that race.
 */

const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/**
 * Return the URL when it is safe to put in an href, or null.
 *
 * Relative paths and in-page fragments are allowed: they cannot change origin
 * and a report legitimately links to its own blocks and to files beside it.
 * A `data:` URI is refused for a link, even though an image accepts one: a
 * navigable data: URL runs in this origin, and an image does not.
 */
export function safeHref(value) {
  if (typeof value !== 'string') return null;

  // Strip the characters a browser ignores inside a scheme but a naive check
  // does not: tab, newline, carriage return, and leading or trailing space.
  const raw = value.replace(/[\t\n\r]/g, '').trim();
  if (!raw) return null;

  if (raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) {
    return raw;
  }

  // A bare relative path with no scheme separator, for example `report.json`.
  if (!raw.includes(':')) return raw;

  try {
    const parsed = new URL(raw, 'https://dossier.neorgon.com/');
    return ALLOWED.has(parsed.protocol) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Return the source when it is safe for an img, or null.
 *
 * Wider than `safeHref` on purpose: an inlined screenshot as a `data:` URI is
 * how a report stays self-contained, and an image source cannot navigate.
 */
export function safeImageSrc(value) {
  if (typeof value !== 'string') return null;
  const raw = value.replace(/[\t\n\r]/g, '').trim();
  if (!raw) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/i.test(raw)) return raw;
  return safeHref(raw);
}
