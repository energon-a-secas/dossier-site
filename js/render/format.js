/**
 * Formatting utilities: numbers, bytes, durations, dates.
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

/**
 * Format date: accepts YYYY-MM-DD or ISO string, returns readable form.
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
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
