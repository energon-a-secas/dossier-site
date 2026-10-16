# Dossier: frozen module contracts

Frozen 2026-10-10, before any builder started. In a greenfield build the
contracts between subsystems are the only thing that cannot be refactored
cheaply later, and the fleet's own record says the single largest waste in a
multi-agent campaign was a complete build against a contract that moved under
it. These signatures do not change during the build. A builder who needs one
changed stops and says so.

**Revised 2026-10-16**, for the reading desk revamp (docs/DESIGN.md has the
reasons). Where a section changed it says so in a line starting "Revised";
sections 12 to 15 are new. Everything else stands as frozen.

## 0. Vocabulary

- **document**: the whole `{ dossier: {...} }` object as authored.
- **model**: the document after parsing, coercion and derivation. The renderer
  only ever sees a model.
- **finding**: one lint or validation result.
- **set** (added 2026-10-16): one comparison in the Compare view: its columns,
  how it is shown, and the reviewer's record. Section 14.
- **bundle** (added 2026-10-16): a set as it leaves the browser,
  `{ dossierCompare: {...} }`.

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

Revised: YAML is parsed by `js/vendor/js-yaml.mjs`, loaded only when YAML text
reaches the parser. A caller that may hand it YAML awaits `initYaml()` first
(`needsYaml`, `yamlReady`).

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

Revised: `ctrf.js` and `lighthouse.js` joined the list. `html.js` keeps the
complete document in one `embed` block and lifts nothing: the Dossier format
view reads the text through the compare IR (section 14) instead. It sets
`scripts: true` only when the inert tree holds an executable script element or
an `on*` handler attribute, and it throws the size sentence over
`HTML_MAX_CHARS` rather than returning `{document: null}`, which the Open
dialog would read as "not this format". `js/adapters/index.js` also detects a
comparison bundle (`COMPARISON_BUNDLE`), which no adapter converts.

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

Revised: `renderReport` accepts the wrapped document or the report inside it,
and `opts` grew `titleLevel` (2 in the app, whose Header Kit bar owns the
page's h1), `allPages` (every page in sequence; default for print), `idPrefix`
(in front of every id the render writes, so two reports on one page, as
Compare columns are, never share an id or a chart gradient), and, for the
one-file export, `standalone` with `embedView(block)`. An `embed` block renders
by context: a shell for the live app (`interactive: true`, filled by
js/embeds.js), the reader's chosen view in an export, Dossier format in print
and wherever `interactive` is `false` (Compare columns, catalog previews).

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

Revised: this is the authored `compare` block inside a report. Comparing whole
reports is the Compare view (section 14), a different thing. `slopeSvg` lives
in `js/render/slope.js` and the bounded line diff in `js/render/line-diff.js`;
`compare.js` re-exports both.

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

Revised: `writeReport(id, document, meta, { expect })`. `meta.updated` is the
record's revision and only goes up; with `expect`, a save made on an older
revision writes nothing and returns `{ conflict: true, current }`, so an old
tab cannot save over a newer edit. `onExternalChange(fn)` calls
`fn(ids, kind)`, `kind` being `'delete'` for a deletion, over the
`dossier-reports` BroadcastChannel.

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

Revised: a fourth inbound form, `#dc=<base64url(deflate-raw(bundle json))>`,
carries a comparison for the Compare view. `encodeComparison(bundle)` returns
`{ payload, fragment, fits }` (a link is offered only while the payload is
under `COMPARISON_LINK_MAX`, 32,000), `decodeComparison(hash)` returns the
bundle or null, and `comparisonLinkId(hash)` is the id the comparison is saved
under (`c-l` and 20 hex digits of the payload's SHA-256), so one link opened
twice is one saved set. `readUrlPayload()` reads what `loadFromUrl()` claimed,
with one reason per failure. `decodeFragment` returns `{ tooLarge }` for a
report over 2,000,000 characters, and inflation stops at a byte budget
(`INFLATE_MAX_BYTES` for `#dc=`, one report's worth for `#dz=`). `?src=`
reads any format the Open dialog reads. Telling a payload from a page route is
`js/router.js` (section 12), not this module.

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

Revised: every choice is reached from one Share and export dialog
(`js/export-dialog.js`), opened by the header's Share button and `e`. An
imported HTML report is exported in the view the reader has on screen
(`embedViewFor` from js/embeds.js), and the file carries the static frame's
fitting (`fitEmbedFrames`) and link policy (`guardFrameLinks`) as source, the
way `bindComparisons` travels. The comparison's own exports are
`js/compare/export.js` (section 14).

## 10. `js/chrome.js` (owner: shell)

NeoKeys owns `H`, the `?` sheet and the WCAG 2.1.4 remap panel. We do not
re-implement any of it and we never write `if (e.key === 'h')`.

Revised 2026-10-16. The 2026-10-10 version of this section hid the Header Kit
bar in read mode with a site rule and let a site toolbar carry the report
actions. That gave the page two headers, and `H` handing the bar back showed
both at once. It is withdrawn. Now:

- The Header Kit bar is the page's only header and the site never hides it.
  Nothing here sets `html[data-chrome]` (the kit paints it from a fleet-wide
  cookie at init) or calls the kit's `chrome.hide()` (which would hide the
  header on every other Neorgon site too). `H` is the kit's alone.
- This module owns three attributes on `<html>`, and js/appearance.js writes
  the first two before the first paint:

```
html[data-dossier-mode]   read | build     build shows the editor pane
html[data-dossier-view]   reports | compare
html[data-dossier-rail]   open | closed    saved reports and the outline
```

```js
export function setMode(mode)                 // 'read' | 'build'; fires `dossier-mode`
export function toggleMode({ viaKey })
export function initialMode({ preferRead, documentChrome })  // the document's `chrome` field can insist
export function setView(view)                 // 'reports' | 'compare'; aria-current; fires `dossier-view`
export function setRail(open, { focus })
export function registerShortcuts(actions)    // through NeoKeys.register
```

Shortcuts registered through `NeoKeys.register`, keeping the fleet meanings:
`/` filter, `s` share, `e` export, `[` and `]` previous and next page.
`h`, `g` and `?` belong to the kit and are not ours to bind.

Revised: one label per key, true in both views, because the kit keeps the
first registration of a key. In Compare `/` opens the Comparisons switcher,
`s` and `e` act on the comparison, and `[` and `]` step through changes (or
headings when differences are off). `r` toggles Edit and Done, in Reports only.

## 11. Findings are rendered, never swallowed

One panel, built from `validate()` plus the parser's findings, grouped by page,
with a count in the header. A fixed-height list that hides the rest is a defect:
the count goes in the header so a clipped list still says how much it clipped.

Revised: the count sits on the report bar's "Check report" button, in words
("1 error, 2 warnings"). While reading the panel is a popover; while editing
it docks beside the editor.

## 12. `js/router.js` (added 2026-10-16)

The one owner of `location.hash`. DOM-free; Node imports it.

```js
export function parseRoute(hash)
// → { view: 'reports', page? } | { view: 'compare', id? }
//   | { anchor } | { payload: true, key: 'dz'|'d1'|'dc' }
export function routeFor(route)   // the inverse, for every route that is not a payload
export function isPayload(hash)
export function isAnchor(hash)
```

**Rules.**
- `#/<page id>` names a page, `#/~compare[/<set id>]` the Compare view. A page
  id never starts with `~`, so the two cannot collide.
- `#dz=`, `#d1=`, `#dc=` (and the legacy `#v1:dz:`) are payloads, never routes.
- A bare `#<anchor>` names a place on the page shown now. Following it changes
  neither the view nor the page, and boot puts the previous address back.
- js/boot.js announces every route as `dossier-route`; the Compare view listens.

## 13. `js/actions.js` (added 2026-10-16)

Every `data-action` control routes through one registry, so a view registers
its own names instead of growing a switch in js/events.js.

```js
export function registerActions(map)        // { name: (el, event) => unknown }
export function runAction(name, el, event)  // → true when a handler ran
```

**Rules.**
- An action with no handler warns in the console: a dead button is a defect.
- The Compare view's names start `cmp-`. `compare-toggle`, `compare-wipe` and
  `compare-opacity` belong to js/comparison-controls.js (the authored block's
  controls, which travel inside the one-file export) and are refused here.

## 14. The Compare view (added 2026-10-16)

`js/compare/model.js` is the shape and every change to it, as pure functions
that return a new set. `js/compare/records.js` `sanitizeSet` is the one door
in for a stored record, a bundle and a link payload: anything it does not
recognise is dropped.

```js
{
  id: 'c-xxxxxxxxxx',            // SET_ID; a set from a #dc= link is 'c-l' + 20 hex
  title: 'Untitled comparison',  // <= 120; follows the first report's title until renamed
  created, updated,              // ms; `updated` is the revision
  prompt: '',                    // the brief every report answered, <= 4,000
  seq: 3,                        // the highest column number dealt; ids are never reused
  columns: [{                    // 0 to 4, shown as A to D
    id: 'k1',
    role: 'human' | 'agent' | 'fix' | 'other',
    label: 'Human',              // <= 40
    author: '',                  // <= 80
    fixes: 'k2' | null,          // role 'fix' only: the column it corrects
    source: null | { kind: 'html' | 'markdown' | 'text' | 'dossier',
                     name, text, note? },   // text <= 2,000,000; null is an empty slot
    mode: null | 'format' | 'original' | 'interactive',   // null follows view.mode
  }],
  view: {
    mode: 'format' | 'original',
    layout: 'columns' | 'focus', focus: 'k1' | null,
    sync: 'sections' | 'scroll' | 'off',
    diff: { on: true, base: null | 'k1' | 'each', showRemoved: true,
            ignoreCase: false, ignorePunctuation: false },
    panel: null | 'sections' | 'review',
    blind: false,
  },
  review: {
    criteria: [{ id: 'accuracy', label: 'Accuracy' }, ...],  // 5 defaults, at most 12
    marks: { accuracy: { k1: 'strong' | 'adequate' | 'weak' | 'na' } },
    notes: { k1: '' },
    preferred: null | 'k1' | 'none',
    summary: '',
    blindAtVerdict: false,       // the verdict was recorded while Blind was on
    blindOrder: null | { k1: 2, k2: 1 },  // the report numbers a blind review was entered under
  },
}
```

**Rules.**
- A source's `note` is kept only when it is one of Dossier's own sentences
  ("Converted from JUnit test results"), so a bundle cannot put a verdict in a
  column under the tool's name.
- `interactive` is the reader's choice in this browser. It survives this
  browser's own IndexedDB and is written as `original` by `toBundle` and read
  as `original` by `fromBundle`, so a file or a link never runs scripts.
- `diff.base` null means the default: "each against its source" when a Fixes
  column and the column it fixes both hold reports (`'each'`), otherwise the
  first column with a report. `diffAgainst(set)` resolves it.
- The review is the reviewer's own. Nothing in the tool writes a score, a
  total, an average or a ranking.
- Portable bundle: `{ dossierCompare: { version: 1, ...the set without id } }`.
  `version` must be 1. A bundle opens under a new id; `node bin/validate.mjs`
  checks reports, not bundles.

Storage, `js/compare/store.js`, never throws, like js/store.js:

```js
export async function listSets()
export async function readSet(id)              // → set | null
export async function writeSet(set, { expect }) // → set | { conflict: true, current } | null
export async function deleteSet(id)
export function onExternalChange(fn)           // the `dossier-compare` BroadcastChannel
```

Database `dossier-compare`, version 1, object store `sets` keyed by `id`, apart
from the `dossier` database so neither needs a version bump. On a conflict the
caller merges three ways (`js/compare/merge.js`) and saves the merge. A change
still waiting when the page hides also goes to the `dossier-site:compare-journal`
localStorage key, replayed at the next visit. A new blank set and the bundled
example are not saved until what they hold changes.

Rendering a column: `format` turns HTML (`normalize.js`, through an inert
`DOMParser` tree), Markdown (`markdown-ir.js`) and text into the IR of
`ir.js`, drawn by `ir-render.js` as escaped markup; a `dossier` source renders
with `renderReport` and an `idPrefix` per column. `original` is a static frame
(`frame.js`: `sandbox="allow-same-origin"`, no scripts). `interactive` is the
`embed.html` host (`sandbox="allow-scripts"`), and sync and differences leave
it alone.

## 15. Appearance and Display options (added 2026-10-16)

`js/appearance.js` is a classic script in `<head>`, external so the page
policy needs no new hash, and it only reads. Before the first paint it sets:

```
html[data-appearance]        light | dark       the resolved palette
html[data-appearance-pref]   system | light | dark
html[data-reading-size]      medium | small | large | xlarge
html[data-measure]           normal | narrow | wide
html[data-typeface]          serif | sans
html[data-compare-size]      reading | compact
html[data-dossier-view], html[data-dossier-mode], html[data-dossier-booting]
```

`js/display.js` owns the Display options dialog. It asks for a theme with a
`dossier-appearance` event (detail `{ preference }`), writes the reading
options to `dossier-site:reading` through the Persist Kit and fires
`dossier-reading` on every change, so a view that measures text measures
again. `READING` in both files must stay equal
(`tests/reading-parity.test.mjs`); the first value of each list is the
default. `html[data-theme]` is never used: it is the Header Kit's visitor
palette.
