# Dossier: product one-pager

**What it is:** a reading desk for reports. It reads any report in one clean
format, and puts two to four reports side by side so a reviewer can see what
each one says, what it left out and what changed. Everything stays in the
reader's browser and travels by link or as one file.

It has two views. **Reports** opens one report at a time: a Dossier document
(a typed JSON file an agent writes, rendered as metric tiles, charts and
before-and-after comparisons), an HTML or Markdown report, test results or a
log. **Compare** holds whole reports in columns with roles (Human, Agent,
Fixes, Other): the human draft, the agent's output, and the fixes made to it.

An HTML report keeps its own look when the reader wants it (Original, a
static copy with its scripts off), or is rebuilt in Dossier's reading format
so every report, and every column, reads the same way. Its scripts run only
when the reader asks, in a sealed frame. The reader chooses the theme, text
size, line width and typeface; the choice stays in their browser.

Dossier describes the text and never judges it. It counts words and sections,
matches headings by their words, and marks what changed; the reviewer records
marks, notes and a preferred report, and the tool never computes a score.
Built-in examples say plainly that their data is illustrative.

**Who it is for:** the engineer who has to review what an agent just did. They
have a diff, a pile of logs, and a summary they cannot check. They need the work
presented the same way every time, so that reading the tenth report is faster
than reading the first. And the reviewer deciding whether an agent's report is
as good as a person's: they need the two read in the same typography, with the
sections lined up and the differences marked, so that formatting and length do
not do the persuading.

**Register:** product (a tool someone uses), not brand (a page someone visits).

**The scene:** a review window on a second monitor, mid afternoon, with the pull
request open in the other half. The reader is scrolling, scanning for the number
that changed and the claim that has no evidence behind it. Or the window is
full width, three columns across: the incident report the on-call engineer
wrote, the one the agent wrote from the same logs, and the agent's report after
the engineer's fixes. They are not presenting to anyone and they will not
install anything.

**What done looks like:** the reader can say which numbers moved, which claims
are sourced, and what the author left out, without opening the repository. In
a comparison they can say which report they would send, and why, with the
names hidden if they want to be fair about it.

## The boundary against Presentation Sage

`slides-site` (Presentation Sage) renders a declarative document into pages and
shares it by link, which is also what Dossier does. The two are not the same
product and the distinction is the page geometry and what the format optimises:

| | Presentation Sage | Dossier |
|---|---|---|
| Unit | a slide, one idea, 16:9, paginated | a page of a document, scrolling, dense |
| Optimised for | a room watching one person talk | one person reading alone, checking |
| First-class output | PowerPoint, Marp, a projector | the screen, print, a self-contained file |
| Numbers | a headline figure, stated | a tile with a baseline, a delta, derived |
| The hard block | a chart that reads from the back row | a diff, a before and after, an evidence link |
| Fails when | the deck says nothing | the reader cannot tell what was measured |

A report is not a deck with smaller text. It is read, not watched, so it can be
dense, it can carry a 60-row table, and it has to answer "is this true?".
Dossier exports to Presentation Sage when a report needs to be presented, which
is the relationship between the two rather than a reason to merge them.
