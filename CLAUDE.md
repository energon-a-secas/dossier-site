# CLAUDE.md: Dossier

A reading desk for reports. **Reports** opens one report (a Dossier JSON or
YAML document, an HTML or Markdown file, test results, a log) and shows it in
one reading format, with an editor for Dossier documents. **Compare** puts two
to four whole reports side by side (Human, Agent, Fixes, Other) so a reviewer
can read a human draft against an agent's output and the fixes, see what
changed word by word, and record a review. The tool describes the text and
never scores it. No account, no server, no session.

**Live:** dossier.neorgon.com · **Port:** 8899

## Run

```bash
make serve
```

Then open http://localhost:8899. It must be served over HTTP: the app is ES modules, and `file://` blocks them.

## The page

- **One header**, the fleet Header Kit bar (`data-header-mode="app"`, `data-header-skin="custom"`), in this order: the view group (`#viewReports`, `#viewCompare`, `aria-current="page"` on the one shown), `Open`, `Share` (the Share and export dialog), `Display` (the "Aa" button), then the kit's home link. There is no site toolbar above or below it any more.
- **Display options** (`#displayDialog`, js/display.js): Theme (System, Light, Dark), Text size (Small 16, Medium 17, Large 18, Extra large 20 px), Line width (Narrow, Normal, Wide: 60, 68 or 73 average advances of the face that rendered), Typeface (Serif, Sans), Compare columns (Same as reading, Compact at 15 px). Each applies at once and is remembered in this browser.
- **Reports view** (`#shell`): the rail (Saved reports with a filter and New, then "This report" outline; docked from 1280 px, a drawer below), the report bar (where the report came from, page count, Check report, Compare, Edit/Done), the report, and the editor pane only while editing. `#welcome` is the empty state and the first visit's front door.
- **An imported HTML report** reads three ways, chosen per report and remembered, never written into the document: Original (default; a static, script-less copy sized to its own height, links open in a new tab), Dossier format (the text rebuilt as escaped markup in the reading typography), and "Run the report's scripts" (the sealed `embed.html` host, offered only when the source has scripts). Print always uses Dossier format.
- **Compare view** (`#compareView`, js/compare/): a toolbar that never wraps (controls fold into Options at 1440, 1100 and 700 px), the columns, and a side panel (Sections or Review) that docks only when every column keeps 400 px. Below 700 px one column shows at a time. The view fills the window and the footer sits below the fold, on purpose.

Routes, owned by js/router.js and nothing else:

| Hash | Means |
|---|---|
| `#/<page id>` | A page of the open report |
| `#/~compare`, `#/~compare/<set id>` | The Compare view: the set already open, else the last one opened, the newest saved or a new blank one; or one saved set |
| `#dz=`, `#d1=` | A report inside the link (deflated, or plain) |
| `#dc=` | A comparison bundle inside the link, deflated; opens in Compare |
| `#<anchor>` | A place on the page shown now (the skip link). Changes neither view nor page |

Shortcuts are registered in js/chrome.js `registerShortcuts`; the README has the table.

## Architecture

Sizes and exports read from the files on 2026-10-16. 136 modules, 29,098
lines, the largest 493. "and N more" is the rest of that file's exports.

### Reports view and shell

| Module | Lines | Owns |
|---|---:|---|
| `js/share.js` | 492 | `INFLATE_MAX_BYTES`, `decompressDeflateRaw`, `encodeDocument`, `COMPARISON_LINK_MAX`, `encodeComparison`, and 9 more |
| `js/open.js` | 437 | `beginOpen`, `openGeneration`, `releaseOpen`, `applyRead`, `onComparisonBundle`, and 19 more |
| `js/boot.js` | 422 | `boot` |
| `js/catalog.js` | 419 | `createCatalogDialog`, `openCatalog`, `loadExamples`, `exampleMeta`, `renderExamples`, and 1 more |
| `js/parse.js` | 419 | `parse`, `initYaml`, `yamlReady`, `needsYaml`, `derive` |
| `js/embeds.js` | 416 | `bindEmbeds`, `embedViewFor` |
| `js/frame-links.js` | 409 | `guardFrameLinks`, `LINK_SELECTOR`, `linkAddress`, `scrollInsideFrame` |
| `js/validate.js` | 408 | `validate` |
| `js/forms.js` | 397 | `fieldLabel`, `itemLabel`, `optionLabel`, `blockForm`, `metaForm` |
| `js/store.js` | 392 | `listReports`, `readReport`, `writeReport`, `deleteReport`, `estimateUsage`, and 1 more |
| `js/pipeline.js` | 390 | `authored`, `carryDerivedMarks`, `commitModel`, `applyText`, `applyParsed`, and 9 more |
| `js/export.js` | 387 | `exportJson`, `exportYaml`, `exportStandaloneHtml`, `exportPrint`, `exportSageDeck`, and 1 more |
| `js/derive.js` | 385 | `markDerived`, `wasDerived`, `derive` |
| `js/library.js` | 354 | `onSaveConflict`, `persistCurrent`, `refreshLibrary`, `filterLibrary`, `readStored`, and 5 more |
| `js/chrome.js` | 314 | `setMode`, `mode`, `toggleMode`, `initialMode`, `setView`, and 8 more |
| `js/source-pane.js` | 291 | `mountEditor`, `syncEditor`, `flushEditor`, `editorPending`, `formatCurrent`, and 11 more |
| `js/display.js` | 255 | `READING`, `readingChoices`, `setReading`, `fitMeasure`, `bindDisplay`, and 3 more |
| `js/events.js` | 251 | `elements`, `bindEvents` |
| `js/embed-fit.js` | 237 | `fitEmbedFrames` |
| `js/editor.js` | 232 | `createEditor`, `formatJson` |
| `js/read.js` | 182 | `readText`, `plainFatal`, `carriesDerived`, `readRecord` |
| `js/export-dialog.js` | 179 | `registerExportActions`, `shareCurrent`, `showExportChoices`, `tierSentence` |
| `js/findings-panel.js` | 168 | `findingPlace`, `createFindingsPanel`, `updateFindingsPanel` |
| `js/appearance.js` | 160 | none (a classic script in `<head>`) |
| `js/report-sync.js` | 154 | `bindReportSync`, `followOtherTab` |
| `js/open-dialog.js` | 143 | `bindOpenDialog`, `resetImport`, `openDroppedFile` |
| `js/report-journal.js` | 124 | `REPORTS_JOURNAL_KEY`, `REPORTS_JOURNAL_MAX`, `TAB_ID`, `reportMeta`, `writeReportJournal`, and 4 more |
| `js/open-line.js` | 116 | `tooLargeSentence`, `describeDetected`, `markDetected`, `htmlSentence` |
| `js/state.js` | 114 | `state`, `loadSaved`, `setPreference`, `forgetPreference` |
| `js/router.js` | 94 | `COMPARE_SEGMENT`, `parseRoute`, `routeFor`, `isPayload`, `isAnchor` |
| `js/text-check.js` | 83 | `NOT_TEXT_MESSAGE`, `notText`, `decodeBytes`, `fileText` |
| `js/seg.js` | 78 | `radioSeg`, `checkRadios`, `bindGroupKeys` |
| `js/scroll-regions.js` | 74 | `fitScrollRegions` |
| `js/authoring.js` | 65 | `reportForm` |
| `js/actions.js` | 64 | `OWNED_BY_COMPARISON_CONTROLS`, `registerActions`, `runAction` |
| `js/embed-policy.js` | 57 | `HTML_MAX_CHARS`, `htmlTooLargeMessage`, `reportTooLargeMessage`, `reportTooLargeBytesMessage`, `embedDocument` |
| `js/comparison-controls.js` | 54 | `bindComparisons` |
| `js/dialogs.js` | 47 | `openDialog`, `bindDialog` |
| `js/frame-focus.js` | 47 | `bindFrameFocus` |
| `js/app.js` | 17 | none (the entry module) |
| `js/hash.js` | 16 | `fnv1a` |
| `js/motion.js` | 10 | `reducedMotion` |

### Format, renderer and adapters

| Module | Lines | Owns |
|---|---:|---|
| `js/render/index.js` | 493 | `renderReport`, `blockHtml`, `outline`, `outlineFlat`, `reportOf` |
| `js/adapters/markdown.js` | 322 | `toDossier` |
| `js/registry/judgment.js` | 314 | `COMPARE_MODES`, `COMPARE_KINDS`, `JUDGMENT` |
| `js/render/compare.js` | 305 | `DEFAULT_SIDE_LABELS`, `compareHtml`, `lineDiff`, `slopeSvg` |
| `js/registry/measurement.js` | 266 | `CHART_FORMS`, `BETTER`, `MEASUREMENT` |
| `js/registry/work.js` | 247 | `FILE_STATES`, `CHECK_STATES`, `WORK` |
| `js/render/embed.js` | 228 | `EMBED_VIEWS`, `EXPORT_VIEWPORT`, `embedViewOf`, `embedFrameTitle`, `embedNote`, and 5 more |
| `js/registry/index.js` | 216 | `BLOCKS`, `blockDef`, `isKnownType`, `blockTypes`, `groups`, and 13 more |
| `js/render/measurement.js` | 204 | `MEASUREMENT_TYPES`, `renderMeasurementBlock` |
| `js/registry/narrative.js` | 197 | `NARRATIVE` |
| `js/render/charts.js` | 191 | `renderChartBlock` |
| `js/render/judgment.js` | 179 | `JUDGMENT_TYPES`, `renderJudgmentBlock` |
| `js/render/format.js` | 178 | `formatNumber`, `formatBytes`, `formatDuration`, `isoDay`, `formatDate`, and 3 more |
| `js/render/trend.js` | 172 | `trendPlot` |
| `js/adapters/junit.js` | 169 | `toDossier` |
| `js/render/narrative.js` | 158 | `NARRATIVE_TYPES`, `renderNarrativeBlock` |
| `js/adapters/index.js` | 151 | `ADAPTERS`, `COMPARISON_BUNDLE`, `detect` |
| `js/adapters/ctrf.js` | 142 | `ctrfTests`, `toDossier` |
| `js/registry/types.js` | 134 | `TYPES`, `field`, `str`, `text`, `num`, and 15 more |
| `js/render/work.js` | 132 | `WORK_TYPES`, `renderWorkBlock` |
| `js/registry/results.js` | 130 | `FINDING_LEVELS`, `TEST_STATES`, `RESULTS` |
| `js/render/results.js` | 123 | `RESULTS_TYPES`, `renderResultsBlock` |
| `js/adapters/html.js` | 121 | `toDossier`, `htmlHasScripts`, `hasScripts`, `hasScriptsByPattern` |
| `js/adapters/lighthouse.js` | 116 | `toDossier` |
| `js/render/outline.js` | 109 | `outline`, `embedHeadingPrefix`, `outlineFlat` |
| `js/adapters/sarif.js` | 108 | `toDossier` |
| `js/adapters/numstat.js` | 92 | `toDossier` |
| `js/adapters/commits.js` | 89 | `toDossier` |
| `js/render/dispatch.js` | 72 | `rendererFor`, `renderBlock`, `missingRenderers`, `rendererClashes` |
| `js/render/url.js` | 67 | `safeHref`, `safeImageSrc` |
| `js/render/markdown.js` | 62 | `inlineMarkdown`, `emptyFrame`, `safeLink` |
| `js/render/slope.js` | 62 | `slopeSvg` |
| `js/render/enums.js` | 55 | `pick`, `enumValues`, `int`, `TONES`, `WIDTHS`, and 1 more |
| `js/render/line-diff.js` | 48 | `splitLines`, `lineDiff` |
| `js/render/chart-data.js` | 44 | `chartColor`, `chartLegend`, `chartValues`, `groupedBars` |
| `js/render/model.js` | 18 | `reportOf` |
| `js/render/ids.js` | 15 | `safeDomId` |

### Compare view

How the folder divides: the set and its changes are `model.js` (pure),
`records.js` (the one door in for records, bundles and links), `store.js`,
`saving.js`, `journal.js` and `merge.js`. Text becomes the IR in `normalize.js`
(HTML), `markdown-ir.js` and `ir.js`, and is drawn by `ir-render.js`; Original
frames are `frame.js` and `static-copy.js`. `align.js`, `sync.js` and
`sections-panel.js` match and follow headings. The differences are `diff*.js`,
`marks.js`, `numbers.js`, `plans.js`, `changes.js` and `ruler.js`, wired by
`analysis.js` through the hooks in `index.js`. The reviewer's record is
`review-model.js` (pure) and `review.js`; Blind is `blind.js`. Every module
says its job in its first comment.

| Module | Lines | Owns |
|---|---:|---|
| `js/compare/index.js` | 474 | `compare`, `initCompare`, `routeCompare`, `compareSettled`, `compareStep`, and 3 more |
| `js/compare/diff.js` | 450 | `diffBlocks`, `alignRange`, `describeRemoved`, `tokenize`, `inlineTokens`, and 3 more |
| `js/compare/model.js` | 450 | `ROLES`, `ROLE_WORDS`, `KINDS`, `KIND_WORDS`, `MODES`, and 47 more |
| `js/compare/column-actions.js` | 440 | `registerColumnActions` |
| `js/compare/export.js` | 438 | `copyComparisonLink`, `comparisonChoices`, `initExport` |
| `js/compare/review.js` | 426 | `createReview` |
| `js/compare/normalize.js` | 403 | `htmlToIr`, `htmlOutline`, `elementToIr` |
| `js/compare/sync.js` | 402 | `READING_LINE`, `JUMP_OFFSET`, `elementScroller`, `followerTarget`, `createSync` |
| `js/compare/markdown-ir.js` | 400 | `markdownToIr`, `inlineRuns` |
| `js/compare/normalize-inline.js` | 391 | `INLINE`, `clean`, `nameOf`, `skipped`, `withoutImages`, and 6 more |
| `js/compare/static-copy.js` | 371 | `stripRefresh`, `staticCopy`, `scriptedCopy`, `remoteResources`, `blockedSentence` |
| `js/compare/analysis.js` | 361 | `initAnalysis` |
| `js/compare/diff-words.js` | 360 | `WORD_MAX_D`, `WORD_MAX_D_FORCED`, `myers`, `intern`, `wordDiff` |
| `js/compare/column.js` | 358 | `effectiveMode`, `bodyKey`, `headHtml`, `labelBody`, `note`, and 1 more |
| `js/compare/changes.js` | 335 | `TICK_OFFSET`, `createChanges` |
| `js/compare/panel.js` | 320 | `createPanel` |
| `js/compare/view.js` | 318 | `mountView`, `renderColumns`, `columnEl` |
| `js/compare/sections-panel.js` | 311 | `sectionsOf`, `buildSections`, `renderSections`, `markSectionRow` |
| `js/compare/actions.js` | 282 | `registerCompareActions` |
| `js/compare/store.js` | 278 | `TAB_ID`, `onExternalChange`, `listSets`, `readSet`, `readSetRecord`, and 2 more |
| `js/compare/export-runtime.js` | 275 | `comparisonRuntime` |
| `js/compare/diff-controls.js` | 268 | `bindDiffControls` |
| `js/compare/align.js` | 267 | `MATCH`, `SAME`, `normHeading`, `prepareHeading`, `prepareHeadings`, and 5 more |
| `js/compare/review-model.js` | 257 | `MARK_WORDS`, `setMark`, `setPreferred`, `setNote`, `setSummary`, and 11 more |
| `js/compare/toolbar.js` | 254 | `toolbarHtml`, `optionsHtml`, `addSlotHtml`, `addMenuHtml`, `syncToolbar`, and 3 more |
| `js/compare/popover.js` | 252 | `PHONE`, `SHORT`, `isPhone`, `isShort`, `openPopover`, and 5 more |
| `js/compare/ir-render.js` | 242 | `renderIr`, `renderInline`, `tableLabel` |
| `js/compare/sources.js` | 240 | `looksLikeDossierYaml`, `tooLargeMessage`, `readSource`, `sourceFromReport`, `comparisonFromReport`, and 1 more |
| `js/compare/records.js` | 237 | `sanitizeSet`, `isBundle`, `toBundle`, `fromBundleWithNotice`, `demotedSentence`, and 2 more |
| `js/compare/marks.js` | 230 | `baseName`, `columnMarks`, `countsSentence` |
| `js/compare/undo-toast.js` | 230 | `TOAST_MS`, `undoToast`, `hideToast` |
| `js/compare/saving.js` | 221 | `createSaving` |
| `js/compare/diff-moves.js` | 191 | `findMoves` |
| `js/compare/extract.js` | 190 | `READING_WPM`, `countWords`, `countNumbers`, `extract`, `sectionCount`, and 2 more |
| `js/compare/diff-heads.js` | 188 | `createDiffHeads` |
| `js/compare/reading.js` | 187 | `createReading` |
| `js/compare/frame.js` | 186 | `staticFrame`, `interactiveFrame`, `blockedLinkSentence`, `frameHeadings`, `frameScroller`, and 8 more |
| `js/compare/bridge.js` | 185 | `openTarget`, `initBridge` |
| `js/compare/diff-lines.js` | 184 | `manyLines`, `codeDiff`, `textLinesDiff` |
| `js/compare/ir.js` | 183 | `WRAPPERS`, `wrapperOf`, `inlineText`, `blockText`, `flattenUnits`, and 3 more |
| `js/compare/brief.js` | 175 | `initBrief` |
| `js/compare/merge.js` | 155 | `mergeSets` |
| `js/compare/section-text.js` | 147 | `CONTENT_MATCH`, `CONTENT_MIN_WORDS`, `BODY_WORDS`, `wordsOf`, `wordDice`, and 2 more |
| `js/compare/blind.js` | 138 | `reportNumbers`, `nameOf`, `roleAttr`, `displayColumns` |
| `js/compare/ruler.js` | 136 | `offsetIn`, `attachRuler`, `keepRulers`, `markCurrentTick`, `redrawRulers` |
| `js/compare/slot.js` | 131 | `copySource`, `slotHtml`, `textFormLabel`, `textFormHtml`, `fillTextForm`, and 1 more |
| `js/compare/numbers.js` | 128 | `isNumberToken`, `numberChanges`, `numberMarks` |
| `js/compare/journal.js` | 126 | `COMPARE_JOURNAL_KEY`, `JOURNAL_COLUMNS_MAX`, `makeJournal`, `validJournal`, `replayJournal`, and 3 more |
| `js/compare/plans.js` | 125 | `sourceId`, `createPlans` |
| `js/compare/crit-menu.js` | 124 | `closeCritMenus`, `toggleCritMenu`, `bindCritMenus` |
| `js/compare/diff-tokens.js` | 124 | `wordKey`, `tokenize`, `inlineTokens`, `withoutLinks`, `tokensToInline` |
| `js/compare/naming.js` | 118 | `reportTitle`, `autoTitle`, `followTitle` |
| `js/compare/example.js` | 96 | `loadExample`, `exampleCard` |
| `js/compare/switcher.js` | 90 | `fillSwitcher`, `filterSwitcher` |
| `js/compare/base-watch.js` | 76 | `watchBase` |
| `js/compare/diff-memo.js` | 60 | `recall`, `remember` |
| `js/compare/icons.js` | 32 | `icon` |

Vendored, never edited in place (see Do not touch): `js/neorgon-*.js`,
`js/neokeys/*`, `js/viz.js`, `js/vendor/js-yaml.mjs`.

## Data

Report bodies and comparisons go in IndexedDB and preferences go in
localStorage, and the split is deliberate: a report with an inlined screenshot
or a 200 KB log exceeds the roughly 5 MB localStorage quota, and a quota error
during a render is worse than a lost preference.

| Where | Key | Holds |
|---|---|---|
| IndexedDB | `dossier` database, v1 | `reports` store: the authored documents. `meta` store: title, kind, status, page count, size in bytes, timestamps (`updated` is the revision) and the tab that wrote it |
| IndexedDB | `dossier-compare` database, v1 | `sets` store keyed by `id`: saved comparisons, each with the tab that wrote it. The shape is in docs/CONTRACTS.md section 14 |
| localStorage | `dossier-site:preferences` | Persist Kit, validated: `sourceTab`, `showFindings`, `lastReportId`, `readMode`, `railOpen` |
| localStorage | `dossier-site:appearance` | Theme: `light` or `dark`, absent for System. A plain string, read before paint |
| localStorage | `dossier-site:reading` | Persist Kit: `readingSize`, `measure`, `typeface`, `compareSize`. Read before paint |
| localStorage | `dossier-site:compare` | Persist Kit: `lastSetId`, the comparison `#/~compare` reopens |
| localStorage | `dossier-site:embed-views` | Persist Kit: the view chosen for each imported HTML report (by saved id, or a content fingerprint), the newest 100 |
| localStorage | `dossier-site:reports-journal` | The open report's last edit, when the page hid with a save under way. Replayed and removed at the next boot |
| localStorage | `dossier-site:compare-journal` | The same for the open comparison |
| localStorage | `neokeys-prefs` | The kit's own shortcut remaps and disable switch, per site |
| Cookie | `neo_chrome` | The kit's `H` state, scoped to `.neorgon.com`, fleet wide by design |
| BroadcastChannel | `dossier-reports`, `dossier-compare` | Another tab wrote or deleted, so this tab refreshes instead of saving over it |

`js/store.js` and `js/compare/store.js` never throw. A failure resolves to
`null`, `false` or an empty list, and a quota problem surfaces as a toast
naming the limit.

## Conventions

- Zero build step. Plain ES modules loaded by `js/app.js`; `js/appearance.js` is the one classic script of ours, in `<head>`, so it runs before the first paint.
- Header and footer come from the shared kits. The only header CSS here is the custom skin's tokens under the kit's contract selector and the view group's `.nav-link` styling, both in css/style.css. Never add site-local `.neo-footer` or `.header-bar` geometry.
- Every control is a `data-action` routed through the registry in js/actions.js. The Compare view's actions are prefixed `cmp-`; the authored `compare` block's own controls use `compare-`. No inline `on*=`, no new inline `<script>` (each needs a sha256 in the page CSP, smoke check 29).
- Anything DOM-free says so in its first comment, and Node tests import it.
- No single JS file over ~500 lines. It currently holds: the largest is `js/render/index.js` at 493.

## Verify

```bash
make check                 # every unit test, the fixtures, the em dash and control byte scan; about a second
npm run test:browser       # Playwright against a running server, 10 scripts
make receipt               # the one-file export, opened with the network cut; runs its own server on 8979
make schema                # twice after a registry change: the first run regenerates and exits 1
cd ../.. && bash scripts/smoke.sh --only=29   # inline script hashes; also 23 (header controls), 24 (favicon, manifest)
```

The browser checks run against `DOSSIER_URL` (default `http://127.0.0.1:8899`)
and write screenshots and exported files to `.verify/<port>/`, so two runs
against two servers never read each other's files. An agent that must not
share the owner's 8899 starts its own on a port outside the fleet's 8800 to
8900 and points the suite at it:

```bash
python3 ../../scripts/serve.py 9404 . &
DOSSIER_URL=http://127.0.0.1:9404 npm run test:browser
```

`check-workspace.mjs` also runs the boot, narrow, reports, saving, details and
reading checks; `check-compare.mjs` ends with the hostile-report, focus and
chrome checks; `check-html-import.mjs` runs the fit, Open dialog and lazy YAML
checks. Each of those can run alone. `make receipt` takes `DOSSIER_PORT`.
Playwright resolves from the monorepo's `node_modules`; a clone outside it
needs `npm i -D playwright` first.

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

**The palette is local, and print is always light.** `css/tokens.css` holds
the Archive paper system: warm paper on a cool archive-board desk, blue-black
ink, manila for "you are here", and four role inks that only ever mark a
column's chrome, never a difference. `js/appearance.js` sets
`html[data-appearance]` before paint; the dark values sit inside
`@media screen`, so paper is light in print whatever the theme. Never set
`html[data-theme]`: that is the Header Kit's visitor palette, and setting it
switches the custom header skin off.

**One header, and `H` is the kit's alone.** An earlier build hid the kit bar
behind a site-made workbar and handed it back on the first `H` press, which
showed two bars on load and a "Chrome hidden" toast at the moment the bar
appeared. Now the kit bar is the only header at every width and every moment.
Nothing here sets `html[data-chrome]` or calls the kit's `chrome.hide()`
(either would hide the header on every other Neorgon tab through the
`neo_chrome` cookie). Read and edit mode is `html[data-dossier-mode]`, set
only by `js/chrome.js`, and it shows or hides the editor pane, never the bar.

**The kit reads `data-keep-mobile` only on direct children of
`.header-actions`.** So it sits on the view group, not on its two buttons, or
both vanish into the phone menu. The kit also moves (never clones) Open, Share
and Display into that menu below 700 px, where an icon-only "Aa" row would
read as nothing: `labelInMenu` in js/display.js adds a visible label while the
button is in the menu and removes it when the kit moves it back. Below 370 px
only the other view's button shows (css/shell.css).

**The hash has one owner.** Four things share `location.hash` (a page, the
Compare route, three payload keys and a bare anchor), and before
`js/router.js` each reader had its own regular expression: a page link read
as a failed share link, and the skip link pressed in Compare dropped the
reader back into Reports. `parseRoute` decides; a page id can never start
with `~`. Keep the payload keyed: an early build put the codec inside the
payload as `v1:dz:` while the caller added `#dz=` on top, so the decoder
refused its own output and nine passing tests never noticed, because none of
them put encode and decode together. Old `#v1:dz:` links still open.

**Every rendered URL goes through `js/render/url.js`.** Escaping is not scheme
checking. The markdown link rule HTML-escaped its target and inserted it into
an href, which escapes the quotes and leaves `javascript:` intact, so any
prose block could ship a working script link. Three modules each had their own
copy of that function. There is now one, in `js/render/markdown.js`, and the
compare IR (`js/compare/normalize.js`, `markdown-ir.js`, `ir-render.js`) uses
`safeHref` and `safeImageSrc` for every link and image too.

**Two kinds of frame, and never both tokens on one.** A `srcdoc` frame
inherits this page's origin, so `allow-scripts` with `allow-same-origin` is
not a sandbox: the frame can reach `parent.document` and every stored report.
A static frame (Original, the default) is `sandbox="allow-same-origin"` and
nothing else: no script in it runs, and being same-origin is what lets this
page read its headings and height, drive its scroll and catch its links. A
frame that runs scripts is the opaque `embed.html` host with
`sandbox="allow-scripts"` only. A mode change builds a new element; never
change a token on a live frame.

**Running a report's scripts is the reader's choice, never content.**
`embed.html` has its own policy (inline scripts and styles, no external
assets), and `js/embeds.js` sends the source only to the matching frame's
WindowProxy. The choice is remembered per report in this browser. A
comparison column's `interactive` mode survives this browser's own IndexedDB
but is demoted to Original at the bundle and link boundary
(`js/compare/records.js`), so a shared file or link can never ask for scripts.
Do not relax the page CSP for imported scripts.

**Comparisons live in their own database.** `dossier-compare` rather than a
store inside `dossier`, so the reports database needed no version bump and
none of the blocked-upgrade hazards that come with one: a tab holding the old
version blocks the upgrade, and storage looks empty for the session.

**A write started as the page unloads never commits.** Chromium drops the
transaction with the page, even after an explicit `commit()`. So when the page
hides with a save still under way, each view also writes a small synchronous
journal to localStorage (`js/report-journal.js`, `js/compare/journal.js`),
replayed at the next visit, and only over a version it knows: a record still
at the revision the edit was made on, or last written by the same tab.

**Two tabs on one record are expected.** Every save names the revision
(`updated`) it was made on. A report saved from an older revision is refused
and the reader chooses which to keep (`js/report-sync.js`); a comparison is
merged key by key (`js/compare/merge.js`), so a note typed in one tab and a
mark clicked in the other both stay. Before this, an old forgotten tab saved
its stale copy over newer work the next time anything was edited in it.

**Differences are counted in steps, never in milliseconds.** Every Myers run
has an edit cap and the whole column one work budget, both counted in steps.
A budget in milliseconds marked 300 changed paragraphs on a fast machine and
none on a slow one, so the same two reports looked different to two
reviewers. Results are memoised by IR and content hash, so a redraw that
changed nothing does not diff again.

**A link can be a decompression bomb.** Deflate packs about a thousand to
one, so a crafted link of a few hundred kilobytes could unpack to gigabytes
before any report cap is checked. `#dc=` inflates to at most
`INFLATE_MAX_BYTES` (four columns of the largest report) and `#dz=` to one
report's worth: under the comparison cap a 63 KB `#dz=` link decoded to a
20 MB report. A `#dc=` comparison is saved under a hash of its payload, so
opening the same link twice reopens one copy.

**One size cap: 2,000,000 characters.** `HTML_MAX_CHARS` in
`js/embed-policy.js` is read by the registry, the adapters, the Open dialog,
`?src=` and every Compare column. Three readers used to carry three limits,
and a 648 KB report opened with a success toast and rendered as a blank
frame. `embed.html` cannot import a module under its own policy, so it repeats
the number, and `tests/embed-cap.test.mjs` fails if the two disagree.

**The first frame is decided before any module loads.** `js/appearance.js`
sets the theme, the reading options, `data-dossier-view`, `data-dossier-mode`
and `data-dossier-booting` (which keeps the shell hidden until the first
render). No timer ever reveals the shell: an 8 s fallback could not tell a slow
connection from a broken one and showed an empty "Nothing open" shell while
the modules were still arriving. A slow boot says "Loading" after 900 ms; a
module that fails to load says so. The reading options list is written twice,
in that classic script and in `js/display.js`, and
`tests/reading-parity.test.mjs` holds the two equal.

**Line width is measured in the face that rendered.** `fitMeasure` in
`js/display.js` lays out a fixed English sample in the reading face (roman and
italic) and the UI face and publishes each average advance; the tokens
multiply it by the chosen character count. A `ch` tuned on one Apple font gave
other faces lines of 77 to 82 characters. Wide can still reach 76 in a rare
paragraph, which WCAG 1.4.8's 80 allows.

**A frame's focus ring is polled.** Focus inside a frame belongs to the
frame's document, so Chromium matches neither `:focus` on the iframe nor
`:focus-within` around it, and focus moving from one frame straight to
another fires nothing in this page. `js/frame-focus.js` marks the active
frame with `data-focus-ring`, checking four times a second while a frame has
focus.

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
the console blaming the wrong thing. The page now loads 144. `scripts/serve.py`
sets `protocol_version = 'HTTP/1.1'`. If you see random module load failures,
check you are not on an older copy of that script.

**A browser caches these ES modules harder than the no-cache header suggests.**
While verifying, a stale module map served old code for several minutes and the
fix "did not work" when it was already on disk. Append a throwaway query to the
page URL when checking a change in a browser.

## Do not touch

- `js/neorgon-*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`. The header's look is changed through the custom skin tokens in css/style.css, never by editing the kit or running a sync from this project.
- `js/viz.js` and `css/viz.css`: the Viz Kit. Refresh with `packages/neorgon-ui/sync-viz.sh`, which this project contributed because the kit had no sync script and therefore no drift check.
- `js/neokeys/*` and `css/neorgon-keys.css`: NeoKeys. Refresh with `sync-keys.sh`. Editing a copy fails `sync-keys.sh --check`, which gates the fleet.
- `js/vendor/js-yaml.mjs`: js-yaml 5.4.1, MIT, loaded by dynamic import only when the input is not JSON. Vendored rather than fetched from a CDN so the site keeps working offline, which is the product's whole promise.
- `schema.json`, `llms.txt`, `SKILL.md`: generated from the registry by `make schema`. Edit the registry or `bin/gen-*.mjs`, never these.
