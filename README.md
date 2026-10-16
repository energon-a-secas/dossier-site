<div align="center">

# Dossier

Read and compare reports: HTML, Markdown and Dossier JSON, side by side in your browser

[![Live][badge-site]][url-site]
[![HTML5][badge-html]][url-html]
[![CSS3][badge-css]][url-css]
[![JavaScript][badge-js]][url-js]
[![Claude Code][badge-claude]][url-claude]
[![License][badge-license]](LICENSE)

[badge-site]:    https://img.shields.io/badge/live_site-0063e5?style=for-the-badge&logo=googlechrome&logoColor=white
[badge-html]:    https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white
[badge-css]:     https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white
[badge-js]:      https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[badge-claude]:  https://img.shields.io/badge/Claude_Code-CC785C?style=for-the-badge&logo=anthropic&logoColor=white
[badge-license]: https://img.shields.io/badge/license-MIT-404040?style=for-the-badge

[url-site]:   https://dossier.neorgon.com/
[url-html]:   #
[url-css]:    #
[url-js]:     #
[url-claude]: https://claude.ai/code

</div>

---

## Overview

Dossier is a reading desk for reports. Open a report and read it in one clean
format, whatever it was written in: an HTML report with its own styling, a
Markdown file, test results, or a Dossier document. Or put two to four reports
next to each other (a human draft, an agent's output, the fixes) and see what
each one says, what it left out and what changed word by word.

A Dossier document is a small typed JSON file an agent writes about its work:
metric tiles with derived deltas, charts, before-and-after comparisons, diffs,
test runs and findings. The agent states what it measured and the site does
the arithmetic, because a wrong number in a report about correctness is the
worst defect this kind of tool can ship.

Everything happens in your browser. There is no account, no server and no
session. A report or a comparison you share travels inside its own link, and
the one-file exports open with no account, no install and no network.

**Live:** dossier.neorgon.com

---

## Two views

**Reports.** One report at a time. Saved reports and the open report's outline
sit in a rail on the left, a bar above the report says where it came from and
how many pages it has, and Edit opens the editor beside it. A first visit
opens on a short welcome with examples.

**Compare.** Two to four whole reports in columns, each with a role (Human,
Agent, Fixes, Other) and a letter (A to D). Drop a file into a column, choose
one, paste text, use a report saved in Reports, or start a Fixes column from a
copy of the column it fixes. Columns read in **Dossier format** (the same
typography for every column, so you judge the content and not the styling) or
in each report's **Original** layout.

---

## Features

- **One reading format**: HTML, Markdown and text are rebuilt as escaped text in
  the reading typography, and Dossier documents render with the full report
  renderer. Display options set the theme (System, Light or Dark), the text
  size, the line width, the typeface and a compact size for compare columns
- **HTML reports three ways**: Original (the report's own look, a static copy
  with its scripts off, sized to its own height, links opening in a new tab),
  Dossier format, or "Run the report's scripts" in a sealed frame with no
  network and no access to the page. The choice is kept per report in this
  browser
- **Sections that line up**: headings are matched across columns by their
  words, and scrolling follows matched sections (or proportion, or nothing).
  The Sections panel shows which sections each report has, has under another
  name, or left out
- **Differences like tracked changes**: inserted and removed words against a
  base column, changed, added, removed and moved passages, a change ruler, a
  "3 of 41" counter with previous and next, and a list of the numbers that
  changed. With a Fixes column, each column is marked against its own source
- **A review that never scores**: criteria by columns marked Strong, Adequate,
  Weak or N/A, notes per report, a preferred report and a summary. Dossier
  counts what you entered and never computes a score. Blind hides who wrote
  each report, deals them as "Report 1, 2, 3" in a fixed shuffled order, and
  says when a verdict was recorded blind
- **A brief**: the question every report answered, kept with the comparison
- **One typed document**: 27 block types described in a registry the
  validator, the renderer, the form, the schema and `llms.txt` all read, so
  they cannot disagree about the format
- **The renderer does the math**: deltas, percentages, totals, diff line
  counts and axis ceilings are derived, never asked for
- **Evidence on any claim**: every block takes sources, each marked with who
  established it: a machine check, a person, or the model itself
- **Reads other formats**: a git diff, JUnit XML, SARIF, CTRF, a Lighthouse
  report, a Conventional Commits log, Markdown, or HTML
- **A form, not HTML**: the block catalog previews each type with the real
  renderer, and the editing form is generated from the same registry
- **Share and export**: one dialog. A report goes out as a link, one HTML
  file, JSON, YAML, print or PDF, or a Presentation Sage deck. A comparison
  goes out as a link (while it fits), one HTML file with every mark and the
  review, a `.dossier-compare.json` file, or the review as Markdown
- **Check report**: the linter coaches rather than rejects, and names the fix
  every time
- **Two tabs, no lost work**: saves name the revision they were made on, so an
  old tab cannot write over newer work, and an edit made as the page closes is
  kept and saved on the next visit

---

## Block types

Grouped as the catalog shows them. The full field list is in `llms.txt`, and
`schema.json` is the machine-readable contract.

| Group | Blocks |
|---|---|
| Narrative | `heading` `prose` `callout` `quote` `steps` `kv` `grid` |
| Measurement | `metrics` `chart` `gauge` `scorecard` `table` |
| Work | `files` `diff` `code` `log` `checklist` `timeline` `findings` `tests` |
| Comparison | `compare` |
| Judgment | `risks` `actions` `decision` |
| Attachment | `image` `embed` `evidence` |

---

## Keyboard shortcuts

Registered through the fleet NeoKeys kit, so every one of them can be turned
off or rebound from the `?` sheet.

| Key | Reports | Compare |
|---|---|---|
| `?` | The shortcut sheet, with the disable switch and rebinding | The same |
| `H` | Hide or show the header bar | The same |
| `/` | Filter saved reports (opens the rail first) | Open the Comparisons switcher to find a comparison |
| `S` | Copy a share link | Copy the comparison's link |
| `E` | Share and export | Share and export the comparison |
| `[` `]` | Previous and next page | Previous and next change, or heading when differences are off |
| `R` | Edit or done | Not used |

---

## For an agent writing a report

```bash
# The contract, and a worked example that validates clean
curl https://dossier.neorgon.com/llms.txt
curl https://dossier.neorgon.com/schema.json

# Check a report before handing it over
node bin/validate.mjs report.json   # 0 clean, 1 findings, 2 could not run
```

`schema.json` is JSON Schema draft-07, self-contained and under 60 KB, which
is what the agent platforms that accept a caller-supplied schema will take.

To hand over a comparison instead, emit `{"dossierCompare": {...}}` with up to
four columns, each with a role and a source; `llms.txt` has the rules. Save it
as `<name>.dossier-compare.json` and open it from the Open dialog.

---

## Running locally

ES modules require an HTTP server (not `file://`):

```bash
make serve             # http://localhost:8899
make check             # registry audit, every test, the fixtures, the byte scan
npm run test:browser   # the browser checks, against a running server (DOSSIER_URL overrides)
make receipt           # build the one-file export and check it with the network cut
make schema            # regenerate schema.json, llms.txt and SKILL.md
```

---

## Architecture

![Architecture](docs/architecture.svg)

The diagram is the Reports pipeline. The Compare view reads the same files
through `js/compare/`: HTML, Markdown and text become one intermediate
representation, which the columns draw, align and compare.

```
dossier-site/
├── index.html              # the shell: one Header Kit bar, Reports, Compare, dialogs
├── embed.html              # the sealed host that runs a report's scripts
├── schema.json             # generated from the registry, draft-07
├── llms.txt  SKILL.md      # generated: the contract, as instructions
├── js/
│   ├── registry/           # the format itself, as data. Everything reads it
│   ├── parse.js            # text to model. Never throws, never destructive
│   ├── derive.js           # the arithmetic the author is not asked for
│   ├── validate.js         # the same rules in the browser, the CLI and tests
│   ├── adapters/           # git, JUnit, SARIF, CTRF, Lighthouse, md, HTML
│   ├── render/             # the one renderer. Exports derive from its output
│   ├── compare/            # the Compare view: columns, sync, differences, review
│   ├── router.js           # the one owner of the URL hash
│   ├── appearance.js       # theme, reading options and view, before first paint
│   ├── display.js          # the Display options dialog and the measured line width
│   ├── chrome.js           # mode, view, rail, and the NeoKeys registration
│   ├── embeds.js           # an imported HTML report's three views
│   ├── store.js            # IndexedDB: report bodies, many of them
│   ├── share.js            # #dz=, #dc= and ?src=, the fleet transport contract
│   ├── export.js           # JSON, YAML, one HTML file, print, a Sage deck
│   └── open.js  read.js  library.js  pipeline.js  source-pane.js  ...
├── css/                    # tokens, shell, report, blocks, compare (+ vendored kits)
├── fixtures/               # minimal, complete (every block type), messy, foreign formats, hostile HTML
├── reports/                # eleven example reports and, in compare/, an example comparison
├── bin/                    # validate, gen-schema, gen-llms
├── scripts/                # the browser checks and the export receipt
└── tests/                  # plain node --test
```

---

<div align="center">
<sub>Part of <a href="https://neorgon.com/">Neorgon</a></sub>
</div>
