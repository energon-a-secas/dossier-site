# Dossier: frozen module contracts

Frozen 2026-10-10, before any builder started. In a greenfield build the
contracts between subsystems are the only thing that cannot be refactored
cheaply later, and the fleet's own record says the single largest waste in a
multi-agent campaign was a complete build against a contract that moved under
it. These signatures do not change during the build. A builder who needs one
changed stops and says so.

## 0. Vocabulary

- **document**: the whole `{ dossier: {...} }` object as authored.
- **model**: the document after parsing, coercion and derivation. The renderer
  only ever sees a model.
- **finding**: one lint or validation result.

## 1. `js/registry/*` (built, do not edit)

```js
import { BLOCKS, blockDef, isKnownType, blockTypes, groups,
         aliases, derivedFields, requiredFields, auditRegistry,
         ENVELOPE, META, PAGE, TYPES, TONES, WIDTHS, KINDS, STATUSES,
         CHECKED_BY } from './registry/index.js';
```

Every other module reads the format from here. No module hard-codes a block
type name in a switch. The renderer dispatches through a table keyed by
`blockDef(b.type)`.

## 2. `js/parse.js` (owner: ingest)

```js
/**
 * @param {string} text        JSON or YAML source
 * @param {{ format?: 'json'|'yaml'|'auto' }} [opts]
 * @returns {ParseResult}
 */
export function parse(text, opts)

/** @typedef {object} ParseResult
 * @property {Model|null} model     null only when nothing could be read
 * @property {Fatal|null} fatal     a syntax error, with a position
 * @property {Finding[]} findings    coercions and structural complaints
 */

/** @typedef {object} Fatal
 * @property {string} message
 * @property {number|null} line     1-indexed
 * @property {number|null} column
 * @property {string} snippet       three source lines around the position
 */
```

**Rules.**
- `parse` never throws. Any internal error becomes a `fatal`.
- A malformed block is **kept** in the model with `block.__error` set to a
  string, so the renderer draws an error card in place and the page still
  renders. It is not dropped.
- Every coercion appends a finding at level `info` naming the path and both
  spellings. Aliases come from `aliases()`, never from a literal.
- Derived fields supplied by the author are deleted from the model and reported
  at level `warn`.

```js
/** Derivation, pure, applied by parse and re-appliable by tests. */
export function derive(model)
```

Derives, and nothing else: metric `delta` and `deltaPct` from `value` and
`baseline`, metric `direction` from `delta` and `better`, `files.totals`,
`checklist.done`, `scorecard.passed`, `diff.stats` from the patch, `log.lines`,
chart `max` to a round ceiling, block `id` from `title`, page `id` from `title`.

## 3. `js/validate.js` (owner: contract)

```js
/**
 * @param {Model} model
 * @returns {Finding[]}
 */
export function validate(model)

/** @typedef {object} Finding
 * @property {'error'|'warn'|'info'} level
 * @property {string} message        written as coaching, naming the fix
 * @property {string} path           'pages[0].blocks[3]' or 'dossier.title'
 * @property {string|null} page      page title, for grouping in the panel
 * @property {string|null} rule      a stable id, for suppressing one rule
 */

/** Counts for the report header. Pure. */
export function claimAudit(model)
// → { blocks, withEvidence, unsourced, byChecker: {code,human,llm,none} }
```

`validate` runs the envelope checks, then each block's own `lint` array from
the registry. A lint rule signature is `(block, add, ctx)` where
`add(level, message)` and `ctx` exposes `{ countOfType, page, model, path }`.
Rules are DOM-free and must not throw; the runner catches and reports.

**Exit codes for every CLI in this project: 0 clean, 1 findings, 2 could not
run.** That is the fleet convention and it is what lets an agent gate on it.

## 4. `js/adapters/*.js` (owner: ingest)

Each adapter is one file, one export, pure, DOM-free except where noted:

```js
/**
 * @param {string} source
 * @returns {{ document: Document|null, findings: Finding[] }}
 */
export function toDossier(source)
```

Adapters to build, in this order:
`numstat.js` (git diff --numstat and --name-status) · `junit.js` (the stable
attribute subset only) · `sarif.js` (SARIF 2.1.0) · `commits.js` (Conventional
Commits) · `markdown.js` · `html.js` (wrap as an `embed` block, and a best
effort lift of tables and headings into native blocks).

`html.js` is the one adapter allowed to use `DOMParser`, and it must parse into
an inert document, never into the live one.

## 5. `js/render/index.js` (owner: renderer)

**There is exactly one renderer.** Every export derives from its output.

```js
/** Render a whole model into a container. Idempotent. */
export function renderReport(model, container, opts)
// opts: { page?: string, print?: boolean, interactive?: boolean }

/** One block to an HTML string. The unit every export reuses. */
export function blockHtml(block, ctx)

/** The page outline, for the sidebar and the tab strip. */
export function outline(model)
```

**Rules.**
- `blockHtml` returns a string and touches no global state, so the export path
  and the live view cannot diverge.
- A block whose type is unknown renders a labelled error card naming the type
  and the nearest valid type names. It never renders nothing.
- An empty block renders a dashed labelled frame saying what is missing, the
  way the Viz Kit's `empty()` does. A gap must be visible.
- Charts go through the Viz Kit (`js/viz.js`). No site-local chart code except
  the comparison primitive below.
- No inline `onclick`. Interactive controls carry `data-action` and one
  delegated listener in `js/events.js` handles them.

## 6. `js/render/compare.js` (owner: renderer)

The one visual primitive the fleet does not already own, and the reason this
site exists. Built here, contributed to `packages/neorgon-ui/js/viz.js` once
its shape has survived real use.

```js
export function compareHtml(block, ctx)   // side | slider | overlay | toggle
export function slopeSvg(pairs, opts)     // before/after dumbbell, one row per label
```

`slopeSvg` follows the Viz Kit conventions exactly: returns a string, takes
`{uid, title, scale, ariaLabel, width, height, colors, animate, frame}`, puts a
`<title>` on every point, and uses `--viz-*` tokens only.

## 7. `js/store.js` (owner: workspace)

Report bodies live in IndexedDB because a report with an inlined screenshot
exceeds the localStorage quota, and the fleet Persist Kit is for preferences.

```js
export async function listReports()            // → ReportMeta[] , newest first
export async function readReport(id)            // → { meta, document }
export async function writeReport(id, document, meta)  // → ReportMeta
export async function deleteReport(id)
export async function estimateUsage()           // → { bytes, quota, pct }
export function onExternalChange(fn)            // another tab wrote; returns unsubscribe
```

**Rules.**
- Nothing here ever throws. A failure resolves to `null` or `false` and reports
  through the returned value, because losing a saved report is bad and a blank
  page during render is worse.
- Preferences only, and only validated ones, go through `neorgon-persist.js`
  under the key `dossier-site:preferences`.
- A quota failure surfaces as a visible toast naming the limit, never silently.
- Two tabs are expected. `onExternalChange` exists so the second tab notices
  instead of clobbering.

## 8. `js/share.js` (owner: transport)

The fleet contract, extended with compression. The inbound forms are the same
three `slides-site` and `proctor-site` already answer to, so an agent that
learned one tool can drive this one.

```
Inbound   #d1=<base64url(json)>              uncompressed, forward compatible
          #dz=<base64url(deflate-raw(json))> the one we emit
          ?src=<https url>                   fetch a hosted document
Outbound  copyShareLink() builds #dz=
```

```js
export async function encodeDocument(document)  // → { payload, bytes, tier }
export async function decodeFragment(hash)      // → { document, findings } | null
export function loadFromUrl()                   // → boolean: a URL source claimed the load
export async function copyShareLink()
```

**Rules.**
- `https://` only for `?src=`, plus `http://localhost` so the contract is
  testable in dev.
- The fragment is cleared with `history.replaceState` after a successful load,
  so an edited report and a stale URL cannot diverge.
- Size tiers, measured on report-shaped JSON at about 3x: `travels` under
  2,000 chars, `fine` under 8,000, `large` under 32,000 with a warning that
  chat clients may break it, and above that a refusal that offers the
  self-contained file instead of telling the reader to go and host something.
- `?via=` belongs to the header kit's analytics. Never read it, never put it
  inside a payload.

## 9. `js/export.js` (owner: transport)

```js
export function exportJson(model)
export function exportYaml(model)
export async function exportStandaloneHtml(model)   // one file, opens offline
export function exportPrint()                       // window.print, print CSS owns it
export function exportSageDeck(model)               // Presentation Sage YAML
```

`exportStandaloneHtml` reuses the live renderer's output and inlines every
readable stylesheet by walking `document.styleSheets`, swallowing cross-origin
sheets rather than failing. It aborts with a visible message if the collected
CSS is empty, because a silent empty export is the failure mode this pattern
exists to prevent. The result needs no network, no account and no install.

## 10. `js/chrome.js` (owner: shell)

NeoKeys owns `H`, the `?` sheet and the WCAG 2.1.4 remap panel. We do not
re-implement any of it and we never write `if (e.key === 'h')`.

**The render mode is site-owned, not kit-owned.** The kit's `restore()` paints
`data-chrome` from a fleet-wide cookie at init, so a page that sets
`data-chrome="off"` for its own reasons gets overwritten, and calling
`chrome.hide()` would hide the header on every other Neorgon site too. So:

```css
html[data-dossier-mode="read"] .header-bar { display: none; }
```

set by us, cleared by us, never persisted to the fleet cookie. `H` continues to
work as the visitor's own preference and as the escape hatch.

Shortcuts registered through `NeoKeys.register`, keeping the fleet meanings:
`/` filter, `s` share, `e` export, `[` and `]` previous and next page.
`h`, `g` and `?` belong to the kit and are not ours to bind.

## 11. Findings are rendered, never swallowed

One panel, built from `validate()` plus the parser's findings, grouped by page,
with a count in the header. A fixed-height list that hides the rest is a defect:
the count goes in the header so a clipped list still says how much it clipped.
