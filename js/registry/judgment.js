/**
 * Comparison, judgment and attachment blocks.
 *
 * The comparison block is the reason this site exists. The fleet Viz Kit has
 * thirteen builders and not one of them renders two things next to each other,
 * which is the single most common shape in a report about a fix: it was like
 * this, now it is like that. Everything else here is borrowed vocabulary:
 * the action-item table from the SRE postmortem genre, and the context,
 * decision and consequences triple from architecture decision records, whose
 * third field is the one an agent always omits and a reviewer always wants.
 */

import { str, text, num, int, bool, url, date, enom, arr, obj, TONES } from './types.js';
import { HTML_MAX_CHARS } from '../embed-policy.js';

export const COMPARE_MODES = Object.freeze([
  'side',    // two panels, read together
  'slider',  // one frame, a draggable wipe between them (images)
  'overlay', // stacked, opacity controlled (images)
  'toggle',  // one frame, a switch between them
]);

export const COMPARE_KINDS = Object.freeze(['text', 'code', 'image', 'metrics', 'table', 'log']);

export const JUDGMENT = [
  {
    id: 'compare',
    name: 'Side-by-side comparison',
    group: 'Comparison',
    summary: 'Responses, execution results or a before-and-after change, read together.',
    when: 'Compare outputs from two prompts or runs, or inspect a visual change.',
    fields: {
      mode: enom(COMPARE_MODES, { note: 'Defaults to side. slider and overlay need images.' }),
      kind: enom(COMPARE_KINDS, { required: true, note: 'Both sides are the same kind.' }),
      prompt: text({ maxLen: 4000, note: 'Optional shared prompt or task, shown above both sides.' }),
      left: obj(
        {
          label: str({ maxLen: 40, note: 'Defaults to "Before".' }),
          caption: str({ maxLen: 160, note: 'Run settings or context for this response.' }),
          value: text({ note: 'Text, code or a log. Use src for an image.' }),
          src: url({ note: 'Image only.' }),
          items: arr('any', { note: 'Metrics or table rows, matching the kind.' }),
          columns: arr('any', { note: 'Table kind only.' }),
        },
        { required: true },
      ),
      right: obj(
        {
          label: str({ maxLen: 40, note: 'Defaults to "After".' }),
          caption: str({ maxLen: 160, note: 'Run settings or context for this response.' }),
          value: text(),
          src: url(),
          items: arr('any'),
          columns: arr('any'),
        },
        { required: true },
      ),
      language: str({ maxLen: 24, note: 'Code kind only.' }),
      highlightChanges: bool({ note: 'Text and code: mark the lines that differ. On by default.' }),
    },
    sample: {
      type: 'compare',
      title: 'How the limit was counted',
      kind: 'code',
      language: 'ts',
      left: { label: 'Before', value: 'const count = local.get(key) ?? 0;' },
      right: { label: 'After', value: 'const count = await shared.get(key) ?? 0;' },
    },
    lint: [
      (b, add) => {
        const imageModes = ['slider', 'overlay'];
        if (imageModes.includes(b.mode) && b.kind !== 'image') {
          add('error', `Mode "${b.mode}" wipes between two images. With kind "${b.kind || '?'}" there is nothing to wipe, so use mode "side" or "toggle".`);
        }
        const sides = [['left', b.left], ['right', b.right]];
        sides.forEach(([name, side]) => {
          if (!side) { add('error', `Comparison has no ${name} side.`); return; }
          if (b.kind === 'image' && !side.src) {
            add('error', `The ${name} side of an image comparison has no src.`);
          }
          if (['text', 'code', 'log'].includes(b.kind) && typeof side.value !== 'string') {
            add('error', `The ${name} side of a ${b.kind} comparison has no value.`);
          }
        });
        if (b.left && b.right && b.left.value && b.left.value === b.right.value) {
          add('warn', 'Both sides of the comparison are identical, so the block shows a change that did not happen.');
        }
      },
    ],
  },

  {
    id: 'risks',
    name: 'Risks',
    group: 'Judgment',
    summary: 'What could still go wrong, how bad, and what is in place.',
    when: 'The work is shipped and the reader has to decide whether to worry.',
    fields: {
      items: arr(
        obj({
          title: str({ required: true, maxLen: 160 }),
          severity: enom(['high', 'medium', 'low'], { required: true }),
          likelihood: enom(['likely', 'possible', 'unlikely']),
          mitigation: text({ maxLen: 400 }),
          owner: str({ maxLen: 80 }),
        }),
        { required: true, min: 1, max: 30 },
      ),
    },
    sample: {
      type: 'risks',
      items: [
        {
          title: 'The shared counter is a single point of failure',
          severity: 'medium',
          likelihood: 'unlikely',
          mitigation: 'Falls back to the per-process counter when the store is unreachable, which is the old behaviour rather than an outage.',
        },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach((r) => {
          if (r && r.severity === 'high' && !r.mitigation) {
            add('warn', `Risk "${r.title || '?'}" is high severity with no mitigation. A named risk with no answer reads as a warning the author decided not to act on.`);
          }
        });
      },
    ],
  },

  {
    id: 'actions',
    name: 'Action items',
    group: 'Judgment',
    summary: 'What happens next, who owns it, and whether it is done.',
    when: 'The report ends and work remains. Borrowed from the SRE postmortem.',
    fields: {
      items: arr(
        obj({
          label: str({ required: true, maxLen: 200 }),
          intent: enom(['mitigate', 'prevent', 'process', 'other'], {
            note: 'Why this action exists. Prevention and mitigation are different promises.',
          }),
          state: enom(['done', 'todo', 'in-progress', 'dropped'], { required: true }),
          owner: str({ maxLen: 80 }),
          due: date(),
          href: url({ note: 'The ticket.' }),
        }),
        { required: true, min: 1, max: 40 },
      ),
    },
    sample: {
      type: 'actions',
      title: 'Next',
      items: [
        { label: 'Roll the shared counter to production', intent: 'mitigate', state: 'todo', owner: 'Platform', due: '2026-10-16' },
        { label: 'Add a per-route limit to the config schema', intent: 'prevent', state: 'todo' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        const open = items.filter((i) => i && ['todo', 'in-progress'].includes(i.state));
        const unowned = open.filter((i) => !i.owner).length;
        if (unowned && open.length) {
          add('info', `${unowned} open action(s) have no owner. An unowned action item is a wish.`);
        }
        items.forEach((i) => {
          if (i && i.state === 'dropped' && !i.href) {
            add('info', `"${i.label || '?'}" is dropped. Say where that was decided, or it reads as forgotten.`);
          }
        });
      },
    ],
  },

  {
    id: 'decision',
    name: 'Decision',
    group: 'Judgment',
    summary: 'The context, the choice, and what it costs. An ADR in one block.',
    when: 'A judgment call was made that a later reader will question.',
    fields: {
      context: text({ required: true, maxLen: 1200, note: 'What made a decision necessary.' }),
      decision: text({ required: true, maxLen: 800, note: 'What was chosen, in the active voice.' }),
      consequences: text({ required: true, maxLen: 1200, note: 'What this costs. The field everyone omits.' }),
      alternatives: arr(
        obj({
          label: str({ required: true, maxLen: 120 }),
          why_not: text({ maxLen: 400 }),
        }),
        { max: 6 },
      ),
      status: enom(['proposed', 'accepted', 'superseded'], { note: 'Defaults to accepted.' }),
    },
    sample: {
      type: 'decision',
      title: 'One shared counter rather than a consensus protocol',
      context: 'Four workers each kept their own bucket, so the configured rate was multiplied by the worker count.',
      decision: 'All workers read and write one counter in the existing store.',
      consequences: 'The store is now in the request path for every rate-limited route, which adds about 1ms and a dependency that can fail. The fallback is the old per-process behaviour.',
      alternatives: [{ label: 'Gossip between workers', why_not: 'Correct under partition, and a week of work for a limiter that only has to be approximately right.' }],
    },
    lint: [
      (b, add) => {
        const c = String(b.consequences || '');
        if (c && !/\b(cost|slower|adds|loses|gives up|trade|risk|depend|instead of|no longer)\b/i.test(c)) {
          add('info', 'The consequences read as benefits. A decision with no cost is usually a decision whose cost has not been found yet.');
        }
      },
    ],
  },

  {
    id: 'image',
    name: 'Image',
    group: 'Attachment',
    summary: 'A screenshot or a diagram, with a caption.',
    when: 'The change is visual, or a diagram beats three paragraphs.',
    fields: {
      src: url({ required: true, note: 'An https URL or a data: URI. A data: URI makes the report self-contained and large.' }),
      alt: str({ required: true, maxLen: 200, note: 'Required. A screenshot with no alt text is invisible to half the fleet audit.' }),
      caption: str({ maxLen: 200 }),
      zoom: bool({ note: 'Click to open full size. On by default.' }),
    },
    sample: {
      type: 'image',
      src: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 80'%3E%3Crect width='240' height='80' fill='%23f4f5f7'/%3E%3Cpath d='M8 72h224' stroke='%23999'/%3E%3Cg fill='%23c2410c'%3E%3Crect x='20' y='66' width='16' height='6'/%3E%3Crect x='48' y='60' width='16' height='12'/%3E%3Crect x='76' y='22' width='16' height='50'/%3E%3Crect x='104' y='12' width='16' height='60'/%3E%3Crect x='132' y='18' width='16' height='54'/%3E%3Crect x='160' y='58' width='16' height='14'/%3E%3Crect x='188' y='64' width='16' height='8'/%3E%3C/g%3E%3C/svg%3E",
      alt: 'A spike of 429 responses between 09:00 and 11:00',
      caption: 'The storm that started the investigation',
    },
    lint: [
      (b, add) => {
        if (!b.alt) {
          add('warn', 'Image has no alt text, so the block is empty for anyone who cannot see it.');
        }
        if (typeof b.src === 'string' && b.src.startsWith('data:') && b.src.length > 400000) {
          add('info', 'An inlined image over about 300 KB will not fit in a share link. It survives a file export.');
        }
      },
    ],
  },

  {
    id: 'embed',
    name: 'Embed',
    group: 'Attachment',
    summary: 'Foreign HTML, rendered sandboxed in its own frame.',
    when: 'You already have an HTML artefact and will not rewrite it as blocks.',
    fields: {
      html: text({ maxLen: HTML_MAX_CHARS, note: 'Complete HTML, including styles and inline assets, up to 2,000,000 characters. Rendered in an isolated frame; external resources are blocked.' }),
      src: url({
        note: 'A remote URL is not framed: this page\'s policy refuses third-party frames, so the block renders a link and says why. Use "html" for content you want shown inline.',
      }),
      height: int({ note: 'Frame height in pixels. Defaults to 780; single-artifact reports fit the viewport.' }),
      scripts: bool({ note: 'Allow inline controls inside the isolated frame. Off by default. External scripts and access to the workspace are blocked.' }),
    },
    sample: {
      type: 'embed',
      title: 'Coverage report, as generated',
      html: '<table><tr><th>File</th><th>Covered</th></tr><tr><td>bucket.ts</td><td>94%</td></tr></table>',
    },
    lint: [
      (b, add) => {
        if (!b.html && !b.src) {
          add('error', 'An embed needs "html" or "src".');
        }
        if (b.src && !b.html) {
          add('info', 'A remote embed URL is shown as a link, not a frame, because this page refuses third-party frames. Inline the HTML in "html" to render it.');
        }
        if (b.scripts === true) {
          add('info', 'Inline controls run in an isolated preview. External resources and access to the workspace are blocked.');
        }
        if (typeof b.html === 'string' && /<script\b/i.test(b.html) && b.scripts !== true) {
          add('info', 'The embedded HTML contains a script tag, which will not run. Set "scripts": true if it is load bearing, or convert the output to blocks.');
        }
      },
    ],
  },

  {
    id: 'evidence',
    name: 'Evidence',
    group: 'Attachment',
    summary: 'A standalone list of artefacts, each with who checked it.',
    when: 'A page needs a sources section, rather than a pointer per block.',
    fields: {
      items: arr('evidence-item', { required: true, min: 1, max: 60 }),
    },
    sample: {
      type: 'evidence',
      title: 'How this was checked',
      items: [
        { label: 'Load test, 200 rps for 60s', kind: 'run', checkedBy: 'code', href: 'https://example.invalid/runs/8812' },
        { label: 'Reviewed by the on-call rotation', kind: 'doc', checkedBy: 'human' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach((e) => {
          if (e && !e.href && !e.hash && !e.excerpt) {
            add('info', `Evidence "${e.label || '?'}" has no link, digest or excerpt, so it names an artefact the reader cannot reach.`);
          }
        });
        if (items.length && items.every((e) => e?.checkedBy === 'llm')) {
          add('warn', 'Every item here was established by a model. That is a set of claims rather than a set of checks, and the report should say so plainly.');
        }
      },
    ],
  },
];
