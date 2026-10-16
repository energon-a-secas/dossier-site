# Sharing reports and comparisons

Both views share and export from one place: the header's **Share** button,
or `E`, opens the Share and export dialog for whatever is on screen. `S`
copies the link directly. Every file and link carries the authored document,
never the derived model, so a recipient sees no warnings about fields they
did not write.

## Inbound

A report or a comparison can arrive in your browser through a URL:

- `#dz=...` a compressed report, this is what Dossier emits
- `#d1=...` an uncompressed report, kept for forward compatibility
- `#dc=...` a compressed comparison bundle; it opens in the Compare view
- `?src=https://...` a hosted document to fetch, in any format the Open dialog reads

`#/<page id>` and `#/~compare` are places in the app, not payloads, and
`js/router.js` is what tells them apart. Old links of the shape `#v1:dz:...`
still open.

A comparison from a `#dc=` link is saved in this browser under an id taken
from the link itself, so opening the same link again reopens that copy
instead of saving another.

## Size tiers for a report link

Measured on report-shaped JSON at about 3x compression:

- Under 2,000 characters: travels everywhere (email, Slack, Discord)
- Under 8,000 characters: fine (most chat and messaging)
- Under 32,000 characters: works in browsers, some chat clients truncate it
- Over 32,000 characters: refused; use the one HTML file instead

When Dossier copies a link, it tells you which tier the report is in.

A comparison link is offered only while its payload is under 32,000
characters. The dialog states the size before you copy it; past that it says
why there is no link and offers the files.

## Copy a share link

`S`, or Copy link in the dialog, puts the open report (or comparison) on the
clipboard. The link is valid on its own in any browser; you do not need this
site or a server. The fragment contains the entire report, encoded and
compressed.

A shared URL is a bearer token. Anyone with the link has the report, and a
comparison link carries every column's report and the review. There is no
access control and no expiration. Treat it like a password.

## Files

From Reports:

- **One HTML file**: the same rendering as the screen, inlined stylesheets and
  tokens, and embedded page navigation. It opens offline with zero network
  requests. An imported HTML report goes in the view you were reading it in.
- **JSON document** and **YAML document**: the source, for editing or for
  another tool.
- **Print or PDF**: every page in sequence, light paper, links printed. An
  HTML report prints in Dossier format, because a frame prints as one clipped
  box.
- **Presentation Sage deck**: for when a report has to be presented.

From Compare:

- **One HTML file**: the comparison as you see it, every difference mark and
  the review included, with sync and the previous and next change buttons
  working offline. A file made while Blind is on keeps the names hidden in its
  markup too.
- **Comparison file**: every report, the view and the review, as
  `.dossier-compare.json`. It opens again from the Open dialog.
- **Copy review as Markdown**: your marks, notes and summary, for a ticket or
  a message.

A column set to run its report's scripts leaves in Original layout, in the
file and in the link: whoever opens it chooses for themselves.

## Hosted documents

Fetch a report from an HTTPS URL with `?src=https://...` (`http://localhost`
is allowed for development). The request times out after 10 seconds, and a
document over 2,000,000 characters is refused before it is opened. Failed and
empty fetches report different messages; a lost network connection is not the
same as a malformed document.
