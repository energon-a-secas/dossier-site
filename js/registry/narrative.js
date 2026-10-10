/**
 * Narrative and layout blocks: the prose a report is held together by.
 *
 * Every entry is data. Adding a block type is one object here, not an edit to
 * a renderer switch, a validator switch, a sample table and a docs table.
 */

import { str, text, num, int, bool, url, enom, arr, obj, TONES } from './types.js';

export const NARRATIVE = [
  {
    id: 'heading',
    name: 'Heading',
    group: 'Narrative',
    summary: 'A section break inside a page. Feeds the page outline.',
    when: 'A page covers more than one thing and the reader needs to skip.',
    fields: {
      text: str({ required: true, maxLen: 90 }),
      level: int({ values: [2, 3], note: 'Defaults to 2. There is no level 1: the report title is the h1.' }),
    },
    sample: { type: 'heading', text: 'What changed in the limiter' },
    lint: [
      (b, add) => {
        if (b.level && ![2, 3].includes(b.level)) {
          add('warn', 'Heading level is 2 or 3. A report has one h1 and it is the title.');
        }
      },
    ],
  },

  {
    id: 'prose',
    name: 'Prose',
    group: 'Narrative',
    summary: 'A paragraph or two. Inline markdown only, never a block element.',
    when: 'The reader needs the reasoning, not another number.',
    fields: {
      text: text({ required: true, maxLen: 2400 }),
    },
    sample: {
      type: 'prose',
      text: 'The limiter counted requests per process, so four workers allowed four times the configured rate. It now shares one counter.',
    },
    lint: [
      (b, add) => {
        const t = String(b.text || '');
        if (t.length > 1200) {
          add('info', 'Prose over 1,200 characters. Two blocks read better than one wall, and a heading between them reads better still.');
        }
        if (/<\/?(div|p|table|ul|ol|h[1-6]|script|iframe)\b/i.test(t)) {
          add('warn', 'Prose carries block HTML. Only inline markdown renders: bold, italic, code, links. Use a real block type instead.');
        }
      },
    ],
  },

  {
    id: 'callout',
    name: 'Callout',
    group: 'Narrative',
    summary: 'One boxed sentence the reader must not scroll past.',
    when: 'A caveat, a risk, or the one thing that is still broken.',
    fields: {
      text: text({ required: true, maxLen: 600 }),
      label: str({ maxLen: 24, note: 'Defaults to the tone: Note, Good, Risk, Warning.' }),
    },
    sample: {
      type: 'callout',
      tone: 'warn',
      text: 'The fix is deployed to staging only. Production still runs the per-process counter.',
    },
    lint: [
      (b, add, ctx) => {
        if (ctx.countOfType('callout') > 4) {
          add('info', 'More than four callouts in one report. When everything is boxed, nothing is.');
        }
      },
    ],
  },

  {
    id: 'quote',
    name: 'Quote',
    group: 'Narrative',
    summary: 'Someone else\'s words, attributed.',
    when: 'A reviewer, a ticket, or an error message said it better.',
    fields: {
      text: text({ required: true, maxLen: 600 }),
      who: str({ maxLen: 60 }),
      role: str({ maxLen: 60 }),
    },
    sample: { type: 'quote', text: 'This has been paging us twice a week since June.', who: 'On-call rotation' },
    lint: [],
  },

  {
    id: 'steps',
    name: 'Steps',
    group: 'Narrative',
    summary: 'A numbered procedure, in order.',
    when: 'The reader has to do something, or repeat what you did.',
    fields: {
      items: arr(
        obj({
          title: str({ required: true, maxLen: 120 }),
          detail: text({ maxLen: 600 }),
        }),
        { required: true, min: 2, max: 20 },
      ),
    },
    sample: {
      type: 'steps',
      title: 'How to verify',
      items: [
        { title: 'Point a load generator at staging at 200 requests per second' },
        { title: 'Watch the 429 rate', detail: 'It should settle at the configured ceiling within ten seconds.' },
      ],
    },
    lint: [
      (b, add) => {
        if (Array.isArray(b.items) && b.items.length === 1) {
          add('info', 'A one-item step list is a sentence. Use prose.');
        }
      },
    ],
  },

  {
    id: 'kv',
    name: 'Facts',
    group: 'Narrative',
    summary: 'A label and value list. The facts panel.',
    when: 'Short, flat, unrelated facts: versions, owners, identifiers.',
    fields: {
      items: arr(
        obj({
          label: str({ required: true, maxLen: 40 }),
          value: str({ required: true, maxLen: 200 }),
          href: url(),
          tone: enom(TONES),
        }),
        { required: true, min: 1, max: 20 },
      ),
    },
    sample: {
      type: 'kv',
      title: 'Where this ran',
      items: [
        { label: 'Environment', value: 'staging' },
        { label: 'Commit', value: '4f2a9c1', href: 'https://example.invalid/commit/4f2a9c1' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        if (items.some((i) => String(i?.value || '').length > 120)) {
          add('info', 'A fact value over 120 characters is prose wearing a label. Move it to a prose block.');
        }
      },
    ],
  },

  {
    id: 'grid',
    name: 'Grid',
    group: 'Narrative',
    summary: 'Lays its child blocks side by side. The only container.',
    when: 'Two or three blocks are read together, not in sequence.',
    fields: {
      blocks: arr('block', { required: true, min: 2, max: 4 }),
      columns: int({ values: [2, 3, 4], note: 'Defaults to the number of children.' }),
    },
    sample: {
      type: 'grid',
      blocks: [
        { type: 'metrics', items: [{ label: 'p95 latency', value: 182, unit: 'ms', baseline: 340 }] },
        { type: 'metrics', items: [{ label: 'Error rate', value: 0.3, unit: '%', baseline: 2.1 }] },
      ],
    },
    lint: [
      (b, add) => {
        const kids = Array.isArray(b.blocks) ? b.blocks : [];
        if (kids.some((k) => k && k.type === 'grid')) {
          add('error', 'A grid cannot hold a grid. One level of nesting is the whole layout model.');
        }
        if (kids.some((k) => k && ['table', 'diff', 'log'].includes(k.type))) {
          add('warn', 'A table, diff or log inside a grid gets half the width and scrolls sideways. Give it a row of its own.');
        }
      },
    ],
  },
];
