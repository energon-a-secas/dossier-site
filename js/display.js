/**
 * The Display options dialog, opened from the "Aa" button in the header, and
 * the reading options it sets.
 *
 * Each option is one `<fieldset>` of radio buttons inside `#displayBody`, and
 * one entry in OPTIONS here; the dialog code does not change per option.
 *
 * Theme is applied by js/appearance.js, the classic script that runs before
 * the first paint, because that is the only place a stored choice can take
 * effect without a flash. This module only asks for a change
 * (`dossier-appearance`) and reads the current choice back from
 * `html[data-appearance-pref]`, which is right even when storage is blocked.
 *
 * The reading options (text size, line width, typeface, compare column size)
 * are attributes on <html> that css/tokens.css reads. js/appearance.js sets
 * them before the first paint from `dossier-site:reading`; this module writes
 * that store (the Persist Kit's own, so js/state.js's preferences are never
 * overwritten by it) and sets the attribute at once. A change dispatches
 * `dossier-reading` on document, so a view that measures text (the compare
 * ruler) can measure again.
 *
 * Line length is set in characters of the face that actually rendered, not
 * in a `ch` tuned on one font (design spec 5.3). fitMeasure() lays out a
 * fixed English sample in the reading face (roman and italic) and in the UI
 * face, and publishes each average advance in em (`--measure-advance`,
 * `--measure-advance-italic`, `--measure-advance-ui`); css/tokens.css
 * multiplies them by the chosen character count into `--measure`,
 * `--measure-italic` and `--measure-ui`, so each measure follows the size of
 * whatever text uses it.
 */

import { openDialog, bindDialog } from './dialogs.js';
import { createStore } from './neorgon-persist.js';

const READING_KEY = 'dossier-site:reading';
const store = createStore({ key: READING_KEY, version: 1 });

/**
 * The same list as READING in js/appearance.js, which applies these before
 * paint; tests/reading-parity.test.mjs holds the two equal. The key is the
 * `dataset` name on <html> (readingSize is data-reading-size) and the first
 * value is the default.
 */
export const READING = Object.freeze({
  readingSize: Object.freeze(['medium', 'small', 'large', 'xlarge']),
  measure: Object.freeze(['normal', 'narrow', 'wide']),
  typeface: Object.freeze(['serif', 'sans']),
  compareSize: Object.freeze(['reading', 'compact']),
});

const root = () => document.documentElement;
const validReading = (name, value) => (READING[name].includes(value) ? value : READING[name][0]);

/** The reading options in effect now, as stored. */
export function readingChoices() {
  const out = {};
  for (const name of Object.keys(READING)) out[name] = validReading(name, root().dataset[name]);
  return out;
}

/**
 * Apply one reading option and remember it. Returns false for an unknown
 * option or value, which changes nothing.
 */
export function setReading(name, value) {
  if (!Object.prototype.hasOwnProperty.call(READING, name) || !READING[name].includes(value)) return false;
  root().dataset[name] = value;
  const choices = readingChoices();
  store.save(choices);
  if (name === 'typeface') fitMeasure();
  document.dispatchEvent(new CustomEvent('dossier-reading', { detail: { name, value, choices } }));
  return true;
}

/**
 * name: the radio group's `name`. values: what it accepts. read(): the
 * current value. write(value): apply a new value.
 */
const OPTIONS = [
  {
    name: 'theme',
    values: ['system', 'light', 'dark'],
    read: () => root().dataset.appearancePref || 'system',
    write: (value) => document.dispatchEvent(new CustomEvent('dossier-appearance', {
      detail: { preference: value },
    })),
  },
  ...Object.keys(READING).map((name) => ({
    name,
    values: READING[name],
    read: () => validReading(name, root().dataset[name]),
    write: (value) => setReading(name, value),
  })),
];

// ── The measure ──────────────────────────────────────────────────────────────

/** A paragraph of the kind these reports are made of: times, figures, names. */
const SAMPLE = 'At 14:02 UTC the cart-api 4.18 deploy began rolling out. The release lowered '
  + 'the database connection pool from 50 to 12 connections per instance, a value copied from '
  + 'a staging profile. Under the afternoon peak the pool ran out within two minutes, and '
  + 'requests queued for a connection instead of failing fast.';

/**
 * The faces a line length is set in, each with the property its advance is
 * published as. Italic sets narrower than roman (Iowan's by 13 percent), and
 * the UI face is not the reading face, so a quote or a 13 px note held to the
 * roman reading advance ran to 77 to 82 characters.
 */
const FACES = Object.freeze([
  { property: '--measure-advance', family: 'var(--font-reading)', style: 'normal' },
  { property: '--measure-advance-italic', family: 'var(--font-reading)', style: 'italic' },
  { property: '--measure-advance-ui', family: 'var(--font-ui)', style: 'normal' },
]);

/**
 * Measure the average advance of each face in FACES and publish it in em.
 * Laid out in the page, in the same font stacks the text uses, so the face
 * measured is the face the browser picked. A result outside any plausible
 * text face (a blocked layout, a zero-width probe) leaves that face's CSS
 * fallback, 52ch, in place.
 *
 * @returns {number|null} the roman reading advance in em, or null
 */
export function fitMeasure() {
  const body = document.body;
  if (!body) return null;
  const probes = FACES.map((face) => {
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;'
      + `font-family:${face.family};font-size:100px;font-weight:400;font-style:${face.style};`
      + 'letter-spacing:normal;font-variant-numeric:var(--numerals);';
    probe.textContent = SAMPLE;
    body.appendChild(probe);
    return probe;
  });
  // Every probe is in the page before the first read, so one layout serves all.
  const widths = probes.map((probe) => probe.getBoundingClientRect().width);
  for (const probe of probes) probe.remove();
  let roman = null;
  FACES.forEach((face, i) => {
    const advance = widths[i] / SAMPLE.length / 100;
    if (!Number.isFinite(advance) || advance < 0.3 || advance > 0.8) return;
    root().style.setProperty(face.property, `${advance.toFixed(4)}em`);
    if (i === 0) roman = advance;
  });
  return roman;
}

/** Measure now, and again when web fonts settle (a face can arrive late). */
function followMeasure() {
  fitMeasure();
  const fonts = document.fonts;
  if (!fonts) return;
  fonts.ready?.then(() => fitMeasure()).catch(() => {});
  fonts.addEventListener?.('loadingdone', () => fitMeasure());
}

// ── The dialog ───────────────────────────────────────────────────────────────

let bound = false;

/**
 * Bind once: every change applies at once, there is no Save step. Also
 * starts the measure, which needs no dialog.
 *
 * @param {HTMLDialogElement|null} dialog
 * @param {HTMLElement|null} fallback the "Aa" button, where focus returns
 *   when it is visible; js/dialogs.js picks the next visible control when not
 */
export function bindDisplay(dialog, fallback) {
  if (bound) return;
  bound = true;
  followMeasure();
  labelInMenu(fallback);
  window.addEventListener('storage', (event) => {
    // js/appearance.js has already applied the other tab's choice.
    if (event.key !== READING_KEY && event.key !== null) return;
    fitMeasure();
    if (dialog?.open) syncDisplay(dialog);
  });
  if (!dialog) return;
  bindDialog(dialog, fallback);
  dialog.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
    const option = OPTIONS.find((o) => o.name === input.name);
    if (option && option.values.includes(input.value)) option.write(input.value);
  });
  // A popover closes on a click outside it. A modal dialog receives clicks on
  // its backdrop as clicks on itself, so the test is the pointer's position.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
      && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });
}

/**
 * Show the dialog with every group set to what is in effect now, and focus
 * starting on the checked choice. showModal() focuses the first radio, which
 * is System, so Space there would quietly replace a Light or Dark choice.
 */
export function openDisplay(dialog, opener) {
  if (!dialog) return;
  syncDisplay(dialog);
  openDialog(dialog, opener);
  dialog.querySelector('input[type="radio"]:checked')?.focus();
}

/**
 * Give the "Aa" button a visible name while it sits in the kit's phone menu.
 *
 * In the bar it is an icon-only control: the kit draws a button whose only
 * element child is an SVG as a square glyph, and its name is its aria-label.
 * Below 700 px the kit moves it (moves, never clones) into the `...` menu,
 * where the other rows read "Open" and "Share" and this one read only "Aa".
 * So while it is in the menu it carries a `<span>` with the same words as its
 * aria-label, and the span leaves when the kit moves it back to the bar. The
 * kit's own menu row styles lay the glyph and the words out; no header CSS
 * is added here.
 *
 * @param {HTMLElement|null} button
 */
export function labelInMenu(button) {
  const actions = button?.closest('.header-actions');
  if (!button || !actions) return;
  const sync = () => {
    const label = button.querySelector(':scope > .ds-menu-label');
    const inMenu = Boolean(button.closest('.header-menu'));
    if (inMenu && !label) {
      const span = document.createElement('span');
      span.className = 'ds-menu-label';
      span.textContent = button.getAttribute('aria-label') || 'Display options';
      button.append(span);
    } else if (!inMenu && label) {
      label.remove();
    }
  };
  // The kit moves the button on its own media query; follow the move itself.
  new MutationObserver(sync).observe(actions, { childList: true, subtree: true });
  sync();
}

export function syncDisplay(dialog) {
  for (const option of OPTIONS) {
    const current = option.read();
    for (const input of dialog.querySelectorAll(`input[type="radio"][name="${option.name}"]`)) {
      input.checked = input.value === current;
    }
  }
}
