/**
 * Measurement blocks: everything that puts a number in front of the reader.
 *
 * The rule these all obey: the author states what was measured, the renderer
 * derives what follows from it. A delta, a percentage, a column total and an
 * axis ceiling are arithmetic, and a model asked for arithmetic will sometimes
 * be wrong. A wrong number in a report about correctness is the worst defect
 * this product can ship, so the format does not offer the chance.
 */

import { str, text, num, int, bool, url, enom, arr, obj, TONES } from './types.js';
import { wasDerived } from '../derive.js';

/** Every chart form is backed by a builder in the fleet Viz Kit. */
export const CHART_FORMS = Object.freeze([
  'bar',      // viz.bars
  'stacked',  // viz.bars with array values + keys
  'line',     // viz.line
  'area',     // viz.line with area
  'donut',    // viz.donut
  'radar',    // viz.radar
  'heatmap',  // viz.heatmap
]);

/** Lower is better for some measures, and the arrow has to agree. */
export const BETTER = Object.freeze(['higher', 'lower', 'neither']);

export const MEASUREMENT = [
  {
    id: 'metrics',
    name: 'Metric tiles',
    group: 'Measurement',
    summary: 'A row of headline numbers, each with its baseline and a derived delta.',
    when: 'Always, near the top. This is the block a reader looks at first.',
    fields: {
      items: arr(
        obj({
          label: str({ required: true, maxLen: 40 }),
          value: num({ required: true }),
          unit: str({ maxLen: 12, note: 'ms, %, req/s. Without it the number is a shape.' }),
          baseline: num({ note: 'What it was before. The delta is derived from this.' }),
          target: num({ note: 'What it should be. Renders as a mark, not a number.' }),
          better: enom(BETTER, { note: 'Which direction is good. Defaults to higher.' }),
          delta: num({ derived: true, note: 'Derived from value and baseline. Do not supply it.' }),
          spark: arr(num(), { max: 60, note: 'Recent history, drawn inline. No axes, no labels.' }),
          precision: int({ note: 'Decimal places. Derived from the values when absent.' }),
        }),
        { required: true, min: 1, max: 8 },
      ),
    },
    sample: {
      type: 'metrics',
      items: [
        { label: 'p95 latency', value: 182, unit: 'ms', baseline: 340, better: 'lower' },
        { label: 'Error rate', value: 0.3, unit: '%', baseline: 2.1, better: 'lower' },
        { label: 'Requests served', value: 1420000, unit: 'req/day' },
      ],
    },
    lint: [
      (b, add) => {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach((m, i) => {
          const where = m?.label ? `"${m.label}"` : `tile ${i + 1}`;
          // A supplied delta on a tile. The central derived-field check only
          // walks a block's own fields, and this one lives inside an item, so
          // it is checked here. `wasDerived` is what keeps it from firing on
          // the delta derive() computed, which is every rendered model.
          if (m && m.delta !== undefined && !wasDerived(m, 'delta')) {
            add('warn', `Metric ${where} supplies a delta. It is derived from value and baseline, so the written one is replaced. Remove it.`);
          }
          if (m && !m.unit && Math.abs(Number(m.value)) > 1 && !/%|count|total/i.test(m.label || '')) {
            add('info', `Metric ${where} has no unit. Say what the number is, or it is only a shape.`);
          }
          if (m && m.baseline === undefined) {
            add('info', `Metric ${where} has no baseline, so the reader cannot tell whether it moved.`);
          }
          if (m && m.baseline !== undefined && m.better === undefined) {
            add('info', `Metric ${where} has a baseline but no "better". The arrow guesses that higher is good, which is wrong for latency and error rates.`);
          }
        });
        if (items.length > 6) {
          add('info', 'More than six tiles wrap to a second row and stop reading as headlines. Promote the three that matter.');
        }
      },
    ],
  },

  {
    id: 'chart',
    name: 'Chart',
    group: 'Measurement',
    summary: 'Bars, lines, areas, a donut, a radar or a heatmap over stated series.',
    when: 'A shape over time or across categories says it faster than a table.',
    fields: {
      form: enom(CHART_FORMS, { required: true }),
      unit: str({ maxLen: 12, note: 'Printed on the axis readout.' }),
      categories: arr(str(), { max: 60, note: 'The x axis. Numbered when absent.' }),
      series: arr(
        obj({
          label: str({ maxLen: 40 }),
          values: arr(num(), { required: true, max: 400 }),
          color: str({ note: 'Override the derived palette. Rarely right.' }),
        }),
        { required: true, min: 1, max: 8 },
      ),
      grid: arr(arr(num()), { note: 'Heatmap only: rows of values.' }),
      axes: arr(obj({ key: str(), label: str() }), { note: 'Radar only.' }),
      reference: obj({ value: num(), label: str() }, { note: 'A dashed line: a target, a limit, an SLO.' }),
      max: num({ note: 'Axis ceiling. Derived to a round number when absent.' }),
    },
    sample: {
      type: 'chart',
      title: 'Requests rejected per hour',
      form: 'bar',
      unit: 'req',
      categories: ['09', '10', '11', '12', '13'],
      series: [{ label: 'before', values: [0, 0, 0, 0, 0] }, { label: 'after', values: [12, 340, 410, 388, 402] }],
    },
    lint: [
      (b, add) => {
        const series = Array.isArray(b.series) ? b.series : [];
        if (!b.unit) {
          add('warn', 'Chart has no unit. Say what the numbers are, or the bars are just shapes.');
        }
        if (b.form === 'heatmap' && !Array.isArray(b.grid)) {
          add('error', 'A heatmap reads "grid", not "series".');
        }
        if (b.form === 'radar' && !Array.isArray(b.axes)) {
          add('error', 'A radar needs "axes" to name its spokes.');
        }
        if (b.form === 'donut' && series.length > 1) {
          add('warn', 'A donut shows one series. Only the first is drawn.');
        }
        if (series.length > 1 && b.categories) {
          const n = b.categories.length;
          series.forEach((s, i) => {
            if (Array.isArray(s?.values) && s.values.length !== n) {
              add('warn', `Series ${i + 1} has ${s.values.length} values against ${n} categories. The short one is padded and the chart lies about its tail.`);
            }
          });
        }
        if (series.length > 1 && series.some((s) => !s?.label)) {
          add('warn', 'More than one series and at least one has no label, so the legend cannot name it.');
        }
      },
    ],
  },

  {
    id: 'gauge',
    name: 'Gauge',
    group: 'Measurement',
    summary: 'One value against a range, as a ring or a banded meter.',
    when: 'A single figure has a budget, a threshold or a ceiling.',
    fields: {
      value: num({ required: true }),
      max: num({ note: 'Defaults to 100.' }),
      unit: str({ maxLen: 12 }),
      label: str({ maxLen: 40, note: 'Replaces the centre number.' }),
      bands: arr(
        obj({ to: num({ required: true }), tone: enom(TONES) }),
        { note: 'Turns the ring into a banded meter with a marker.' },
      ),
    },
    sample: { type: 'gauge', title: 'Error budget spent', value: 62, max: 100, unit: '%' },
    lint: [
      (b, add) => {
        if (b.max !== undefined && Number(b.value) > Number(b.max)) {
          add('warn', 'The gauge value is above its max, so the arc is pinned and the reader cannot see by how much.');
        }
      },
    ],
  },

  {
    id: 'scorecard',
    name: 'Scorecard',
    group: 'Measurement',
    summary: 'Criteria with a verdict each. Pass, fail, partial.',
    when: 'The work was judged against a list someone else wrote.',
    fields: {
      criteria: arr(
        obj({
          label: str({ required: true, maxLen: 120 }),
          verdict: enom(['pass', 'fail', 'partial', 'skipped', 'unknown'], { required: true }),
          detail: text({ maxLen: 400 }),
        }),
        { required: true, min: 1, max: 40 },
      ),
      passed: int({ derived: true, note: 'Counted. Do not supply it.' }),
    },
    sample: {
      type: 'scorecard',
      title: 'Acceptance criteria',
      criteria: [
        { label: 'One counter shared across workers', verdict: 'pass' },
        { label: 'Configurable per route', verdict: 'partial', detail: 'Global only. Per-route needs a schema change.' },
        { label: 'Deployed to production', verdict: 'fail', detail: 'Staging only, pending a release window.' },
      ],
    },
    lint: [
      (b, add) => {
        const cs = Array.isArray(b.criteria) ? b.criteria : [];
        cs.forEach((c) => {
          if (c && ['fail', 'partial', 'skipped'].includes(c.verdict) && !c.detail) {
            add('warn', `Criterion "${c.label || '?'}" is ${c.verdict} with no detail. The reader's next question is why, every time.`);
          }
        });
      },
    ],
  },

  {
    id: 'table',
    name: 'Table',
    group: 'Measurement',
    summary: 'Rows and columns, sortable, with derived totals.',
    when: 'The reader needs the individual records, not a shape.',
    fields: {
      columns: arr(
        obj({
          label: str({ required: true, maxLen: 40 }),
          align: enom(['left', 'right', 'center']),
          format: enom(['text', 'number', 'bytes', 'ms', 'percent', 'date', 'status', 'code', 'spark'], {
            note: 'status renders a pill, spark draws the row\'s number array inline.',
          }),
          total: enom(['sum', 'mean', 'max', 'min', 'none'], { note: 'Derived. Printed in a footer row.' }),
        }),
        { required: true, min: 1, max: 12 },
      ),
      rows: arr(arr('any'), { required: true, min: 1, max: 2000 }),
      sort: obj({ column: int(), direction: enom(['asc', 'desc']) }),
      filter: bool({ note: 'Adds a filter field above the table.' }),
    },
    sample: {
      type: 'table',
      title: 'Endpoints touched',
      columns: [
        { label: 'Route' },
        { label: 'Status', format: 'status' },
        { label: 'p95', format: 'ms', align: 'right', total: 'max' },
      ],
      rows: [
        ['POST /login', 'fixed', 182],
        ['POST /token', 'fixed', 164],
        ['GET /me', 'unchanged', 41],
      ],
    },
    lint: [
      (b, add) => {
        const cols = Array.isArray(b.columns) ? b.columns : [];
        const rows = Array.isArray(b.rows) ? b.rows : [];
        if (cols.length > 8) {
          add('info', `${cols.length} columns. Past eight the table scrolls sideways and the reader loses the row.`);
        }
        const bad = rows.filter((r) => Array.isArray(r) && r.length !== cols.length).length;
        if (bad) {
          add('warn', `${bad} row(s) do not have ${cols.length} cells. Short rows are padded and long ones are truncated, so the table would be wrong rather than ugly.`);
        }
        if (rows.length > 200 && !b.filter) {
          add('info', `${rows.length} rows with no filter. Set "filter": true so the reader can find one.`);
        }
      },
    ],
  },
];
