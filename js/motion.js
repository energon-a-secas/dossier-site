/**
 * The reader's motion preference, asked in one place. The Reports reader,
 * the source pane, the report renderer and Compare's sync and change
 * stepping each had a copy of this check.
 */

/** True when the reader asked for less motion. DOM-free: false where there is no matchMedia (node). */
export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
