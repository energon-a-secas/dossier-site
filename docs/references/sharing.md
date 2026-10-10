# Sharing reports

A report can travel through three inbound forms and two outbound forms.

## Inbound

A report can arrive in your browser through a URL:

- `#dz=...` a compressed fragment, this is what Dossier emits
- `#d1=...` an uncompressed fragment, kept for forward compatibility
- `?src=https://...` a hosted document to fetch

## Size tiers

Measured on report-shaped JSON at about 3x compression:

- Under 2,000 characters: travels everywhere (email, Slack, Discord)
- Under 8,000 characters: fine (most chat and messaging)
- Under 32,000 characters: works in browsers, some chat clients truncate it
- Over 32,000 characters: refuse, use standalone HTML export

When Dossier exports a link, it tells you which tier your report is in. If it is too large, use the standalone HTML export instead of trying to share a URL.

## Copy a share link

Copy the current report to the clipboard with the `s` key or the share button. The link is valid on its own in any browser; you do not need this site or a server. The fragment contains the entire report, encoded and compressed.

A shared URL is a bearer token. Anyone with the link has the report. There is no access control and no expiration. Treat it like a password.

## Standalone HTML export

The largest reports export as a single HTML file that opens offline with zero network requests. It contains the same rendering as the screen, inlined stylesheets and tokens, and embedded page navigation. Open it in any browser on any device.

## Hosted documents

Fetch a report from an HTTPS URL with `?src=https://...`. The URL must return valid JSON, and the request times out after 10 seconds. Failed and empty fetches report different messages; a lost network connection is not the same as a malformed document.
