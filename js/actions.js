/**
 * The action registry behind every `data-action` control.
 *
 * A module registers the actions it owns with `registerActions({name: fn})`,
 * and js/events.js routes each delegated click to `runAction`. A view added
 * later registers its own names here instead of growing a switch in
 * js/events.js. An action with no handler is a dead button, so it says so in
 * the console rather than doing nothing quietly.
 */

const handlers = new Map();

/**
 * Actions that another listener owns. js/comparison-controls.js binds the
 * controls of the `compare` block itself, because the same function travels
 * inside the one-file export, where this registry does not exist. These are
 * the full names it handles. The old rule skipped every name starting with
 * `compare-`, which silently swallowed any new action that happened to share
 * the prefix.
 */
export const OWNED_BY_COMPARISON_CONTROLS = Object.freeze([
  'compare-toggle',
  'compare-wipe',
  'compare-opacity',
]);

/**
 * @param {Record<string, (el: HTMLElement, event: Event) => unknown>} map
 */
export function registerActions(map) {
  for (const [name, handler] of Object.entries(map || {})) {
    if (typeof handler !== 'function') continue;
    if (OWNED_BY_COMPARISON_CONTROLS.includes(name)) {
      // eslint-disable-next-line no-console
      console.warn(`data-action="${name}" belongs to js/comparison-controls.js and was not registered`);
      continue;
    }
    if (handlers.has(name)) {
      // eslint-disable-next-line no-console
      console.warn(`data-action="${name}" was registered twice; the later handler wins`);
    }
    handlers.set(name, handler);
  }
}

/**
 * Run one action.
 *
 * @param {string} name the `data-action` value
 * @param {HTMLElement} el the element that carries it
 * @param {Event} [event] the click, so a handler can prevent a link's default
 * @returns {boolean} true when a handler ran
 */
export function runAction(name, el, event) {
  if (!name || OWNED_BY_COMPARISON_CONTROLS.includes(name)) return false;
  const handler = handlers.get(name);
  if (!handler) {
    // eslint-disable-next-line no-console
    console.warn(`No handler for data-action="${name}"`);
    return false;
  }
  handler(el, event);
  return true;
}
