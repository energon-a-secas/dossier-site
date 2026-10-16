# Dossier: design

Written 2026-10-10, before any feature code. Records the decisions and the
reasons, so a later reader can tell a deliberate choice from an accident.
Later changes are added as dated sections, newest first. Where one reverses an
earlier decision it says so, and the earlier text stays as it was written.

## 2026-10-16: a reading desk for reports

The owner's brief for this revamp, in their words: "a place that allows render
or quality comparison for reports, like written by a human compared to output
of an AI agent, then another column at will to render the fixes. The main goal
is to facilitate reading and seeing the rendered HTML reports, but with a
custom format." And the page had two header bars.

So the product changed shape. It was a renderer for one kind of document, the
Dossier JSON an agent writes about its work. It is now a reading desk with two
views: **Reports**, which reads one report of any kind in one format, and
**Compare**, which lays two to four whole reports side by side. The Dossier
format, the registry and every principle in sections 1 to 7 stand; they are
now one of the things the desk reads.

### One header

The page has one header, the fleet Header Kit bar, at every width and every
moment. The site-made workbar (its wordmark, logo, Dark mode button and the
context bar under it) is gone, and with it `html[data-dossier-chrome]` and the
code in js/chrome.js that handed the kit bar back on `H`. That arrangement
showed two bars on load, and pressing `H` produced both at once with a
"Chrome hidden" toast at the moment the bar appeared. **This reverses the
"Chrome hiding belongs to the Keys Kit" paragraph of section 5**, which kept
the global header hidden in both workspace modes and the local toolbar in
charge. `H` is the kit's alone; read and edit mode only shows or hides the
editor pane.

The bar holds, in order: a Reports and Compare view group (`aria-current` on
the one shown), Open, Share, and Display (an "Aa" glyph). On a phone the view
group stays in the bar and the rest goes into the kit's menu; below 370 px only
the button for the other view shows.

No Header Kit edits. The visual spec proposed two changes to the kit (a
stronger resting border on header controls, and a style for `aria-current`).
Neither was made: a kit change alters every site's header and belongs in its
own kit commit, not in one site's revamp. Instead the bar uses the kit's
`custom` skin (tokens only, under the kit's own contract selector) and the
view buttons are `.nav-link` buttons styled with the kit's tokens, which the
kit's zero-specificity rules allow. The resting border stays the kit's; every
header control carries a text label or an accessible name. The bar is the
same ink in both themes, and its middle stop (`#171e2a`) is the page's
theme-color in the meta tag and the manifest.

The first frame is the right one. `js/appearance.js`, a classic script in the
head, decides the theme, the reading options, the view and the mode before the
first paint, and keeps the shell hidden until the first render. No timer
reveals it: an 8 second fallback could not tell a slow connection from a
broken one and showed an empty shell while modules were still arriving.

### Archive paper

The visual system was chosen from three directions by two judges, both for
the same one. Every report is a sheet of warm paper on a cool archive-board
desk, printed in blue-black ink; manila and folder brown say where you are and
where focus is. The desk is grey, not cream, because cream paper on a cream
desk is the most common generated look and left the sheet no edge.

Colour stays quiet so the content can be judged. Four stamp-pad inks mark the
roles (Human violet, Agent amber, Fixes green, Other graphite), only on a
column's chrome and always with the letter and the role word; a role colour
never tints text. Human is violet rather than blue because blue means
"inserted". Differences are a separate channel with three cues each, colour
last: an underline for inserted words, a strike for removed ones, revision
bars and `+`, `~`, `-` glyphs in the gutter. Strikethrough means deletion
everywhere, so a done checklist item is never struck, and "Missing" in the
Sections panel is secondary ink with a hollow circle, never danger red: it is
a fact about the text, not a verdict. Figures are lining everywhere and
tabular in tables, counters and marks, because incident reports are mostly
times, percentages and counts. `css/tokens.css` is the system as shipped.

### Display options instead of a Dark mode button

The "Aa" button opens Display: Theme (System, Light, Dark), Text size (16, 17,
18 or 20 px), Line width (Narrow, Normal, Wide), Typeface (Serif, Sans) and
Compare columns (Same as reading, or Compact at 15 px). Each applies at once
and stays in this browser.

Line width is a number of characters in the face that actually rendered,
measured at run time from a fixed sample, not a `ch` value: one tuned on an
Apple serif gave other faces lines of 77 to 82 characters. Narrow, Normal and
Wide are 60, 68 and 73 average advances. Wide can reach 76 characters in a
rare paragraph, accepted because WCAG 1.4.8 sets the limit at 80. Compact
exists for Compare: three columns at 1440 px give a median line of 48
characters at the reading size and 56 at 15 px. Reports keep the reading size
either way.

### Reports

A slim report bar replaces the context bar: where the report came from
("Saved in this browser", "Example report · illustrative data", "Opened from a
link"), its page count, Check report with a count in words, Compare (start a
comparison from this report), and Edit, which reads Done while editing. The
rail holds the saved reports and the open report's outline in both modes. It
docks from 1280 px and is a drawer below that, which never starts open, so a
stored "open" never covers the report on a laptop; a shared link opens with it
closed, because its reader came for one report.

A first visit opens on a welcome screen instead of an example, because the
front door should say what the tool is for. A stored report or a link still
opens directly. The examples, the bundled comparison first, are on the welcome
screen and in the Open dialog. Share and Export became one dialog, opened by
Share and `e`; `s` still copies the link directly.

### HTML reports, read three ways

Reading rendered HTML reports was the owner's main goal. An imported HTML
report used to open in the scripted host whenever a pattern guessed it had
scripts, and the guess fired on JSON-LD and on the word "onboarding". Now:

- **Original** (the default): a static copy of the report in a frame with
  `sandbox="allow-same-origin"` and no scripts. Being same-origin is what lets
  the page size the frame to its document (one scrollbar, not a box inside the
  page), find its headings for the outline, and catch its links: a web address
  opens in a new tab, an in-page link scrolls. A note says how many remote
  fonts and images were not loaded.
- **Dossier format**: the report's text rebuilt as escaped markup in the
  reading typography, so it follows the Display options. The same
  representation the Compare columns read.
- **Run the report's scripts**: offered only when the source has an executable
  script, in the sealed `embed.html` host with `sandbox="allow-scripts"` alone.

The choice is reader state, remembered per report in this browser and never
written into the document. Print always uses Dossier format, because a frame
prints as one clipped box. The one-file export carries the view on screen.

### Compare

Two to four whole reports in columns, each with a role (Human, Agent, Fixes,
Other), a letter and an optional author. A Fixes column names the column it
corrects. Columns read in Dossier format by default, so every report has the
same typography and the reviewer judges the content, not the styling; Original
shows a report's own look. HTML, Markdown and text become one intermediate
representation (headings, paragraphs, lists, tables, code, quotes, figures),
built from an inert parse and drawn as escaped markup: no node and no markup
from a report ever reaches the page.

- Sections line up by their words, never by meaning: a Needleman-Wunsch
  alignment over a Dice score of character bigrams, then, for a heading an
  agent reworded, the label above it or the wording of the section body. The
  panel says so in as many words. Scrolling follows matched sections at a
  reading line 30% down, or by proportion, or not at all.
- The Sections panel is the "what did the author leave out" view: which of the
  base column's sections each report has, has under another name, or does not
  have, and what only another column has.
- Differences read like tracked changes against a base column. With a Fixes
  column and the column it fixes both filled, each column is marked against its
  own source by default, so in one view the Agent column reads against the
  Human one and the Fixes column against the Agent one. Moved passages are
  found and marked once. The numbers that changed get their own list, because
  in a human against agent comparison a wrong figure is usually the finding
  that matters. Every diff draws on a budget counted in steps, never in
  milliseconds, so the same two reports get the same marks on any machine.
- The review is criteria by columns, each marked Strong, Adequate, Weak or N/A,
  with notes, a preferred report and a summary. Dossier counts what the
  reviewer entered and computes nothing. **The tool never scores content**;
  every count it shows (words, sections, reading time) is labelled
  descriptive, because length and formatting are what sway a reader most
  without being quality.
- Blind replaces names with "Report 1, 2, 3", dealt in an order shuffled from
  the set's id, and also lays the columns out in report order: whoever set up
  the comparison usually put the human draft in column A, so position alone
  was a tell. A verdict recorded while blind says so afterwards.
- The brief, the question every report answered, sits above the columns,
  because a reviewer cannot judge two answers without the question.

Layout: the toolbar never wraps; its controls fold into Options at 1440, 1100
and 700 px, so the reading line stays put. The side panel lies over the
columns until each column can keep 400 px beside it (1600 px for three);
docked earlier, three columns fell to 33 characters a line. Below 700 px one
column shows at a time and panels open as sheets. The view fills the window
under the header and the footer sits below the fold, accepted so the columns
get the whole height.

Data: comparisons have their own IndexedDB database, `dossier-compare`, so the
reports database needed no version bump and none of the blocked-upgrade
hazards. A comparison travels as a `.dossier-compare.json` file, a `#dc=` link
while it fits in 32,000 characters, or one offline HTML file with every mark
and the review. A column that runs its scripts leaves as Original, so a shared
file or link never runs scripts the reader did not ask for.

### Retired: the response composer

The two-textarea "Compare responses" composer made a report holding one
`compare` block. The Compare view does the same job for whole reports
(paste into a column), so the composer was removed rather than kept as a second
way in. The authored `compare` block and its renderer stay, for a report that
carries its own before and after.

### Edits that survive

A write started as the page unloads never commits, so each view also keeps a
small synchronous journal of the last change and replays it at the next visit.
Every save names the revision it was made on: an old tab's report save is
refused and the reader chooses, and a comparison is merged key by key, so two
tabs never silently overwrite each other.

### Code

One router owns the URL hash (`#/<page>`, `#/~compare`, the payload keys and
bare anchors), because four readers with four regular expressions mistook a
page link for a failed share link. One action registry replaces the switch in
js/events.js, so the Compare view registers its own `cmp-` actions. Every JS
file stays under about 500 lines, so js/compare/ is 57 small modules, each
naming its job in its first comment.

Verification for this revamp: `make check`, `npm run test:browser` (ten
Playwright scripts, updated to assert the new interface), `make receipt`,
`make schema`, and smoke checks 23, 24 and 29 for this site.

## 2026-10-11 interface (superseded by the section above)

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
