/**
 * Formatting utilities: numbers, bytes, durations, dates and enum words.
 * DOM-free: node imports it.
 */

/**
 * Format a number the way a person would read it aloud.
 *
 * The first version was `Number(n).toFixed(precision)` with precision
 * defaulting to zero, which rendered an error rate of 0.3 percent as "0" and
 * 1420000 requests as "1420000". Both are wrong in the same way: the default
 * threw away the part of the number that mattered.
 *
 * So precision is derived from the magnitude unless the author states it, and
 * thousands are grouped. A report is read, and a seven digit run of digits is
 * not read, it is counted.
 */
export function formatNumber(n, precision) {
  if (n === null || n === undefined || n === '') return '';
  const value = Number(n);
  if (!Number.isFinite(value)) return '';

  const digits = Number.isFinite(Number(precision))
    ? Math.max(0, Math.min(6, Number(precision)))
    : defaultPrecision(value);

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/**
 * Enough decimals to keep the number meaningful, and no more. A latency in
 * milliseconds does not want three decimal places and an error rate of 0.3
 * percent cannot afford none.
 */
function defaultPrecision(value) {
  const size = Math.abs(value);
  if (Number.isInteger(value)) return 0;
  if (size >= 100) return 0;
  if (size >= 10) return 1;
  if (size >= 1) return 2;
  if (size >= 0.01) return 3;
  return 4;
}

/**
 * Format bytes as human-readable (B, KB, MB, GB).
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[Math.min(i, sizes.length - 1)];
}

/**
 * Format duration in seconds as human-readable (ms, s, m, h).
 */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 0.001) return (seconds * 1000000).toFixed(0) + 'us';
  if (seconds < 1) return (seconds * 1000).toFixed(0) + 'ms';
  if (seconds < 60) return seconds.toFixed(1) + 's';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toFixed(0)}s`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A calendar day written as YYYY-MM-DD, as numbers, or null when the text is
 * not one or names a day that does not exist. Checked in UTC, with no local
 * time involved, so no time zone can move it.
 *
 * @returns {{year: number, month: number, day: number}|null} month 1 to 12
 */
export function isoDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * A date as "8 Oct 2026": the day, a short month, the year, no leading zero.
 *
 * A calendar day is formatted from its own numbers. `new Date('2026-10-08')`
 * is midnight UTC, so formatting it in local time printed "Oct 7, 2026" in
 * any zone west of UTC (the owner's is -03), and '2026-02-30' rolled over to
 * 1 March. The months are spelled here rather than by Intl: en-US puts the
 * month first, and en-GB writes September as "Sept" in Node and Chromium.
 * An instant (a date with a time) is shown on the reader's own day. Anything
 * else ('2026-10', 'Q3 2026', 'Sprint 42') is the author's words, unchanged.
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === '') return '';
  const day = isoDay(value);
  if (day) return `${day.day} ${MONTHS[day.month - 1]} ${day.year}`;
  const instant = typeof value === 'number' ? Number.isFinite(value)
    : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(value).trim());
  if (instant) {
    const d = new Date(typeof value === 'number' ? value : String(value).trim());
    if (!Number.isNaN(d.getTime())) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  return String(value);
}

/**
 * A window between two dates as parts: plain strings and `{text, iso}`, where
 * `iso` is the raw calendar day for a time element, or null. Shortened where
 * the dates share a month or a year: "1 to 15 Oct 2026", "28 Sep to 3 Oct
 * 2026". A side that is not a calendar day is not shortened against.
 *
 * @returns {Array<string|{text: string, iso: string|null}>}
 */
export function formatDateRange(from, to) {
  const d1 = isoDay(from);
  const d2 = isoDay(to);
  const side = (value) => ({ text: formatDate(value) || String(value ?? ''), iso: isoDay(value) ? String(value).trim() : null });
  if (d1 && d2) {
    const end = side(to);
    if (d1.year === d2.year && d1.month === d2.month) return [{ text: String(d1.day), iso: String(from).trim() }, ' to ', end];
    if (d1.year === d2.year) return [{ text: `${d1.day} ${MONTHS[d1.month - 1]}`, iso: String(from).trim() }, ' to ', end];
    return [side(from), ' to ', end];
  }
  return [side(from), ' to ', side(to)];
}

/** Display words for an enum value the format does not spell like a word. */
const ENUM_WORDS = {
  llm: 'Model', ms: 'Milliseconds', asc: 'Ascending', desc: 'Descending', wontfix: "Won't fix", spark: 'Sparkline',
};

/**
 * An enum value as a reader sees it: "in-review" reads "In review". The
 * renderer and the editor's option lists share it, so a status reads the same
 * in the report and in the form that sets it.
 */
export function enumWord(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (Object.hasOwn(ENUM_WORDS, raw)) return ENUM_WORDS[raw];
  const text = raw.replaceAll('-', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Format a cell value based on column format hint.
 */
export function formatCell(value, format) {
  if (value === null || value === undefined) return '';
  switch (format) {
    case 'number':
      return formatNumber(value);
    case 'bytes':
      return formatBytes(value);
    case 'ms':
      return formatDuration(value / 1000);
    case 'percent':
      return formatNumber(value) + '%';
    case 'date':
      return formatDate(value);
    case 'status':
      return String(value);
    case 'code':
      return String(value);
    case 'spark':
      return String(value);
    default:
      return String(value);
  }
}
