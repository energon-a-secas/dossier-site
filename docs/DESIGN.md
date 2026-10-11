# Dossier: design

Written 2026-10-10, before any feature code. Records the decisions and the
reasons, so a later reader can tell a deliberate choice from an accident.

## Current interface

The reader reviews two outputs during the workday with source material in
another window. Light surfaces suit that scene; the same review in a dim room
uses charcoal surfaces and brighter text. A visible Dark mode toggle follows
the system initially and persists the reader's choice. Printing uses light
paper in either mode. The palette lives in `css/tokens.css`: cool neutral surfaces, a violet action
color, slate for series A, and teal for series B. Color does not determine a
winner. Labels, values and textual change markers carry the meaning too.

The report is the main surface. The app toolbar uses text labels, and the
editor stays closed on first visit. Report sections have numbered navigation;
text, metrics and charts use their own hierarchy instead of nesting cards.
The first visit opens an illustrative response comparison. Examples are not
saved until edited. Imports get their own record rather than overwriting the
previous report.

The toolbar includes the existing folder-and-chart logo. HTML artifacts keep
their complete document rather than being flattened into inferred blocks.
Inline controls run in `embed.html`, with an opaque sandboxed origin and a
separate policy that blocks external resources. Only the matching frame can
request its report content. Offline exports carry the same policy and HTML
directly in a sandboxed `srcdoc`, so they need no hosted viewer.

The response composer creates a normal typed document. It does not evaluate
the content or invent scores. Comparison controls are shared between the app
and the offline export. The bounded line diff and slope plot are separate
modules. Multi-series bars compare values independently; stacking must be
requested explicitly. Tables retain zero values and their formatting.

Structural assessment of the changed paths: 6/10 before, 8/10 after. The main
improvements are extracting comparison behavior and arithmetic, removing the
unused duplicate workspace, removing unused template CSS, and fixing form
updates that reused stale snapshots. A future extraction of the remaining
import/export action dispatch from `events.js` would further narrow its role.

Verification: `make check`, `make receipt`, and, with `make serve` running,
`npm run test:browser`. Browser checks cover saving, imports, comparison
controls, template selection, mobile widths and an export with no network.

## 1. The problem

An agent finishes a piece of work and writes a report about it. Today it writes
HTML. That is wrong three times over:

- It spends its output budget on presentation and still gets the presentation
  wrong, because layout is not what it is good at.
- Every report looks different, so a team never develops a reading habit. Two
  reports about the same subsystem cannot be put side by side.
- The reader cannot tell a measured number from a remembered one.

Dossier splits content from presentation. The agent emits a small typed
document. The site owns every pixel, every chart axis and every number that can
be derived. The document is the only thing the two sides agree on.

## 2. Three principles

**The agent states facts, the renderer does the math.** Deltas, percentages,
totals, axis ceilings, diff line counts, sparkline scaling and table sums are
all derived at render time. A model that is asked for a number it could have
computed will sometimes get it wrong, and a wrong number in a report about
correctness is the worst defect this product can ship.

**Tolerant parsing, loud linting.** A malformed block renders as an error card
in its own place and the rest of the report still renders. A parse failure never
destroys the last good render. Every coercion is recorded and shown, so the
author fixes the generator rather than the file.

**Every claim can carry its evidence.** Any block accepts `evidence`. The report
header states how many claims have none. A report an agent wrote about its own
work is a claim until it points at an artefact, and the renderer should make
that visible rather than polish it away.

## 3. What this is not

- Not a BI tool. No queries, no live data sources, no expression language. A
  dossier is a snapshot of stated facts.
- Not a deck builder. Presentation Sage (`slides-site`) owns that, and Dossier
  exports to it rather than competing with it.
- Not a hosted service. No account, no session, no server. The reader needs a
  browser and nothing else.

## 4. Subsystems and the interfaces between them

The block registry is the hinge. Everything else reads it.

```
                    ┌────────────────────────┐
                    │  block registry (data) │  one entry per block type:
                    │  js/registry/*.js      │  fields, sample, lint limits
                    └───────────┬────────────┘
      ┌─────────────┬───────────┼───────────┬──────────────┐
      ▼             ▼           ▼           ▼              ▼
  validator     renderer     catalog     schema.json    llms.txt
  (DOM-free)    (the only    (authoring  (generated)    (generated
                 renderer)    surface)                   table)
```

1. **Registry**: data, not code. Adding a block type is one entry, not an edit
   to five switch statements.
2. **Validator**: DOM-free, so the browser, the CLI and the tests run the same
   rules. Exit 0 clean, 1 findings, 2 unreadable.
3. **Renderer**: exactly one implementation. Every export derives from its DOM.
4. **Workspace**: a library of many reports, IndexedDB for bodies, the fleet
   Persist Kit for preferences.
5. **Transport**: URL fragment in, file in, self-contained HTML out.
6. **Adapters**: foreign formats in (raw HTML, Markdown, and the machine
   formats the research names).
7. **Chrome**: the fleet Keys Kit owns `H`, the `?` sheet and the remap panel.

## 5. Decisions taken, with reasons

**JSON is the native format, YAML is accepted.** Models emit valid JSON more
reliably than valid YAML, and JSON can be constrained by a schema at generation
time. YAML is accepted on input because people edit it by hand.

**One renderer, exports derived from its DOM.** The sibling project maintains
four parallel renderers of one spec and its own notes call content loss in an
export its known failure mode. The self-contained HTML export reuses the live
renderer and inlines `document.styleSheets`, so it cannot drift. That is the
pattern, applied everywhere.

**The share link is deflated, not just base64.** `CompressionStream('deflate-raw')`
is native, needs no dependency, and measures 3x on report-shaped JSON. Measured
on synthetic reports: a 5-page report with 25-row tables is 16 KB of JSON and a
5,550 character link. The sibling's plain base64 would make that 21,900.
The fragment carries a version prefix so the codec can change without breaking
old links.

**A parse error is never destructive.** Keep the last good model on screen,
dim it, show the error with its line and column in a banner. This is the
most-travelled error path in a live-editing tool.

**Chrome hiding belongs to the Keys Kit.** Hand-rolled bare-letter shortcuts
with no remap panel are an accessibility failure, and the fleet already solved
it. The global header stays hidden in both workspace modes, keeping the local
toolbar in charge of report actions. H still reveals it through the Keys Kit;
switching workspace modes never changes the fleet-wide chrome preference.

**No inline `onclick`.** One delegated listener over `[data-action]`.

## 6. Open until the research lands

- Which machine formats to ingest natively, and which to decline.
- Whether the chart block consumes the fleet Viz Kit as-is or needs additions.
- The exact share-link size tiers, pending real-world client limits.
- The provenance model: how far to go beyond an evidence link.

## 7. Risks

- **Scope.** The block vocabulary is the product, and it wants to grow forever.
  The registry makes each addition cheap, which is itself the danger.
- **Trust.** If the renderer makes a weak report look authoritative, it has
  made things worse. The lint panel and the unsourced-claim count exist to
  pull against that.
