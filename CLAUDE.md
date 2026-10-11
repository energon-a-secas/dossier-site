# CLAUDE.md: Dossier

Renders AI-written work reports from one typed JSON document, for the engineer
who has to review what an agent just did and cannot check the summary against
anything. No account, no server, no session.

**Live:** dossier.neorgon.com · **Port:** 8899

## Run

```bash
make serve
```

Then open http://localhost:8899. It must be served over HTTP: the app is ES modules, and `file://` blocks them.

## Architecture

| Module | Lines | Owns |
|---|---:|---|
| `js/neorgon-beacon.js` | 500 | none |
| `js/validate.js` | 485 | `validate`, `claimAudit` |
| `js/events.js` | 452 | `elements`, `bindEvents`, `showFindings`, `showSourceTab` |
| `js/viz.js` | 387 | `skeleton`, `empty`, `error`, `statGrid`, `bars` |
| `js/parse.js` | 380 | `parse`, `initYaml` |
| `js/forms.js` | 366 | `blockForm`, `metaForm` |
| `js/render/index.js` | 363 | `renderReport`, `blockHtml` |
| `js/export.js` | 318 | `exportJson`, `exportYaml`, `exportStandaloneHtml`, `exportPrint`, `exportSageDeck` |
| `js/share.js` | 316 | `encodeDocument`, `decodeFragment`, `fragmentCarriesReport`, `loadFromUrl`, `loadFromUrlAsync` |
| `js/registry/judgment.js` | 311 | `COMPARE_MODES`, `COMPARE_KINDS`, `JUDGMENT` |
| `js/derive.js` | 302 | `markDerived`, `wasDerived`, `derive` |
| `js/neokeys/core.js` | 287 | `RESERVED`, `CONVENTIONAL`, `onChange`, `setTypingSelector`, `isTypingTarget` |
| `js/catalog.js` | 268 | `createCatalogDialog`, `openCatalog` |
| `js/registry/measurement.js` | 267 | `CHART_FORMS`, `BETTER`, `MEASUREMENT` |
| `js/store.js` | 258 | `listReports`, `readReport`, `writeReport`, `deleteReport`, `estimateUsage` |
| `js/adapters/html.js` | 258 | `toDossier` |
| `js/registry/work.js` | 248 | `FILE_STATES`, `CHECK_STATES`, `WORK` |
| `js/editor.js` | 212 | `createEditor`, `formatJson` |
| `js/render/judgment.js` | 198 | `JUDGMENT_TYPES`, `renderJudgmentBlock` |
| `js/registry/narrative.js` | 193 | `NARRATIVE` |
| `js/adapters/markdown.js` | 190 | `toDossier` |
| `js/registry/index.js` | 188 | `BLOCKS`, `blockDef`, `isKnownType`, `blockTypes`, `groups` |
| `js/render/measurement.js` | 185 | `MEASUREMENT_TYPES`, `renderMeasurementBlock` |
| `js/neokeys/overlay.js` | 182 | `open`, `close`, `toggle` |
| `js/render/charts.js` | 178 | `renderChartBlock` |
| `js/pipeline.js` | 176 | `applyText`, `applyParsed`, `applyDocument`, `rerender`, `claims` |
| `js/chrome.js` | 175 | `setMode`, `followVisitorChromeChoice`, `mode`, `toggleMode`, `initialMode` |
| `js/boot.js` | 169 | `boot` |
| `js/neorgon-dom.js` | 157 | `escHtml`, `debounce`, `throttle`, `clamp`, `uid` |
| `js/neorgon-persist.js` | 152 | `safeGet`, `safeSet`, `safeRemove`, `safeGetJSON`, `safeSetJSON` |
| `js/render/compare.js` | 148 | `compareHtml`, `slopeSvg` |
| `js/render/narrative.js` | 143 | `NARRATIVE_TYPES`, `renderNarrativeBlock` |
| `js/findings-panel.js` | 141 | `createFindingsPanel`, `updateFindingsPanel` |
| `js/neokeys/fleet.js` | 139 | `setSource`, `open`, `close`, `toggle`, `count` |
| `js/registry/types.js` | 135 | `TYPES`, `field`, `str`, `text`, `num` |
| `js/registry/results.js` | 131 | `FINDING_LEVELS`, `TEST_STATES`, `RESULTS` |
| `js/adapters/index.js` | 127 | `ADAPTERS`, `detect` |
| `js/adapters/junit.js` | 123 | `toDossier` |
| `js/library.js` | 118 | `persistCurrent`, `refreshLibrary`, `filterLibrary`, `openStored`, `removeStored` |
| `js/neokeys/chrome.js` | 118 | `isHidden`, `setScope`, `isFull`, `show`, `hide` |
| `js/neokeys/index.js` | 116 | `init` |
| `js/render/format.js` | 115 | `formatNumber`, `formatBytes`, `formatDuration`, `formatDate`, `formatCell` |
| `js/render/work.js` | 110 | `WORK_TYPES`, `renderWorkBlock` |
| `js/adapters/lighthouse.js` | 108 | `toDossier` |
| `js/adapters/ctrf.js` | 104 | `toDossier` |
| `js/adapters/sarif.js` | 101 | `toDossier` |
| `js/adapters/numstat.js` | 93 | `toDossier` |
| `js/neokeys/store.js` | 88 | `enabled`, `open`, `toggle` |
| `js/adapters/commits.js` | 85 | `toDossier` |
| `js/render/dispatch.js` | 73 | `rendererFor`, `renderBlock`, `missingRenderers`, `rendererClashes` |
| `js/render/results.js` | 72 | `RESULTS_TYPES`, `renderResultsBlock` |
| `js/render/outline.js` | 71 | `outline`, `outlineFlat` |
| `js/state.js` | 66 | `state`, `loadSaved`, `save`, `setPreference` |
| `js/render/url.js` | 66 | `safeHref`, `safeImageSrc` |
| `js/render/markdown.js` | 63 | `inlineMarkdown`, `emptyFrame`, `safeLink` |
| `js/neorgon-navigation.js` | 44 | `updateQuery`, `createQueryHistory` |
| `js/dialogs.js` | 26 | `openDialog`, `bindDialog` |
| `js/render/model.js` | 19 | `reportOf` |
| `js/app.js` | 18 | none |
| `js/neokeys/boot.js` | 18 | none |
| `js/utils.js` | 6 | `$` |
| `js/render.js` | 5 | `render` |

Vendored from `packages/neorgon-ui/`, never edit in place; run the sync script instead: `js/neorgon-header.js`, `js/neorgon-footer.js`.

## Data

Report bodies go in IndexedDB and preferences go in localStorage, and the split
is deliberate: a report with an inlined screenshot or a 200 KB log exceeds the
roughly 5 MB localStorage quota, and a quota error during a render is worse
than a lost preference.

| Where | Key | Holds |
|---|---|---|
| IndexedDB | `dossier` database, v1 | `reports` store: the documents. `meta` store: title, kind, status, page count, timestamps |
| localStorage | `dossier-site:preferences` | Only validated preferences, through the fleet Persist Kit: source tab, findings panel open, last report id, read mode |
| localStorage | `neokeys-prefs` | The kit's own shortcut remaps and disable switch, per site |
| Cookie | `neo_chrome` | The kit's chrome preference, scoped to `.neorgon.com`, fleet wide by design |

`js/store.js` never throws. A failure resolves to `null` or `false` and a quota
problem surfaces as a toast naming the limit. A second tab is expected:
`onExternalChange` uses a `BroadcastChannel` so the other tab refreshes its
list rather than clobbering what this one has open.

## Conventions

- Zero build step. Plain ES modules loaded by `js/app.js`.
- Header and footer come from the shared kits. Do not add site-local `.neo-footer` or `.header-bar` CSS.
- No single JS file over ~500 lines. It currently holds.

## Gotchas

**The registry is the format. Nothing else is.** `js/registry/*` is data, and
the validator, the renderer, the catalog, the generated `schema.json` and the
generated `llms.txt` all read it. Adding a block type is one object in one
group file plus one entry in that module's `*_TYPES` array. `auditRegistry()`
runs in the tests and fails on a type with no sample, a sample that would not
validate, a field both required and derived, and two fields claiming one alias.

**Two shapes of document, one seam.** `parse()` returns the wrapped
`{dossier: {...}}` and `validate()` checks that shape, so its finding paths
read `dossier.pages[0].blocks[2]`. The renderer wants the report inside.
`reportOf()` in `js/render/model.js` accepts either. The frozen contract did
not say which a "model" was, the parser kept the wrapper, the renderer did not
expect it, and `js/export.js` reached past it for the title while handing the
wrapped object straight to `renderReport`, which rendered "No pages in model"
on every export. Use `reportOf` rather than reaching for `.dossier` yourself.

**Derived fields are marked, and that marking is load bearing.** `derive()`
calls `markDerived(obj, field)` for every value it computes, non-enumerably so
nothing serialises it. `validate()` only complains about a derived field the
*author* supplied. Without the marker, every rendered model reported that its
own computed delta should be removed. If you add a derivation, mark it.

**The document palette is local.** `css/tokens.css` supplies light and dark surfaces,
semantic text and chart colors, type and spacing. Reports remain readable
when the CDN is unavailable. Shared header, footer and keyboard kits stay
vendored; their geometry is not overridden locally. `js/appearance.js` applies
the system or saved preference before paint. Print always uses light paper.

**Read mode is ours; `H` is the kit's.** NeoKeys paints `html[data-chrome]`
from a cookie scoped to `.neorgon.com`, so setting that attribute ourselves is
overwritten at init and calling `chrome.hide()` would hide the header on every
other Neorgon tab. Read mode is `html[data-dossier-mode="read"]` plus
`html[data-dossier-chrome]`, set only by `js/chrome.js`. The handover in
`followVisitorChromeChoice` is deferred with `queueMicrotask` because the kit
dispatches `neo-chrome` *before* it writes its cookie: reacting synchronously
left the header visible and the stored preference saying hidden.

**The share fragment is keyed, and a page route is not a payload.**
`#dz=<base64url>` is deflated and `#d1=` is not. An early build put the codec
inside the payload as `v1:dz:` while the caller added `#dz=` on top, so the
decoder refused its own output and nine passing tests never noticed, because
none of them put encode and decode together. `fragmentCarriesReport()` is what
keeps `#/results` from being treated as a failed share link.

**Every rendered URL goes through `js/render/url.js`.** Escaping is not scheme
checking. The markdown link rule HTML-escaped its target and inserted it into
an href, which escapes the quotes and leaves `javascript:` intact, so any
prose block could ship a working script link. Three modules each had their own
copy of that function. There is now one, in `js/render/markdown.js`.

**An embed that asks for scripts must not also be same-origin.** A `srcdoc`
frame inherits this page's origin, so `sandbox="allow-scripts allow-same-origin"`
is not a sandbox: the frame can reach `parent.document`, read every stored
report and rewrite the page. Omit `allow-same-origin`. With scripts off,
`sandbox=""` is correct rather than a list.

**Interactive HTML uses a separate preview document.** `embed.html` has a
restricted policy allowing inline scripts and styles but no external assets.
`js/embeds.js` sends the source only to the matching frame's WindowProxy. Do
not relax the workspace CSP for imported scripts. Standalone exports inline
the policy and markup into `srcdoc`, avoiding a dependency on the hosted viewer.

**`make check` runs the whole `tests/` directory on purpose.** The first
version named each file, so a test added later was silently never run.
Fixtures are checked against `fixtures/index.json`, in both directions:
`messy.json` must stay broken, and a clean fixture that grows a finding fails.

**`make receipt` opens the bytes, not the code.** Every way the one-file export
fails is invisible from the app. It rendered perfectly on screen while the
downloaded file carried hundreds of unresolved `var(--space-4)` references,
because the fleet tokens live in a cross-origin stylesheet that cannot be
inlined. The token list is now harvested from our own readable stylesheets and
resolved against the live root, so a token the CSS uses cannot be forgotten.

**The dev server needed keep-alive for this site.** 65 ES modules over
HTTP/1.0 exhausted the connection pool and the browser reported
`ERR_CONNECTION_RESET` on a handful of them, with the page looking broken and
the console blaming the wrong thing. `scripts/serve.py` now sets
`protocol_version = 'HTTP/1.1'`. If you see random module load failures, check
you are not on an older copy of that script.

**A browser caches these ES modules harder than the no-cache header suggests.**
While verifying, a stale module map served old code for several minutes and the
fix "did not work" when it was already on disk. Append a throwaway query to the
page URL when checking a change in a browser.

## Do not touch

- `js/neorgon-*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`.
- `js/viz.js` and `css/viz.css`: the Viz Kit. Refresh with `packages/neorgon-ui/sync-viz.sh`, which this project contributed because the kit had no sync script and therefore no drift check.
- `js/neokeys/*` and `css/neorgon-keys.css`: NeoKeys. Refresh with `sync-keys.sh`. Editing a copy fails `sync-keys.sh --check`, which gates the fleet.
- `js/vendor/js-yaml.mjs`: js-yaml 5.4.1, MIT, loaded by dynamic import only when the input is not JSON. Vendored rather than fetched from a CDN so the site keeps working offline, which is the product's whole promise.
- `schema.json`, `llms.txt`, `SKILL.md`: generated from the registry by `make schema`. Edit the registry or `bin/gen-*.mjs`, never these.
