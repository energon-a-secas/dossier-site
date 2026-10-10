# Dossier: product one-pager

**What it is:** Render AI-written work reports from one JSON file: metric tiles,
charts and before-and-after comparisons, kept in your browser and shared by link.

**Who it is for:** the engineer who has to review what an agent just did. They
have a diff, a pile of logs, and a summary they cannot check. They need the work
presented the same way every time, so that reading the tenth report is faster
than reading the first.

**Register:** product (a tool someone uses), not brand (a page someone visits).

**The scene:** a review window on a second monitor, mid afternoon, with the pull
request open in the other half. The reader is scrolling, scanning for the number
that changed and the claim that has no evidence behind it. They are not
presenting to anyone and they will not install anything.

**What done looks like:** the reader can say which numbers moved, which claims
are sourced, and what the author left out, without opening the repository.

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
