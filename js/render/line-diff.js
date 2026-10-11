/** Bounded line comparison, shared by the report and response views. */

export function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const LIMIT = 400;
  if (a.length > LIMIT || b.length > LIMIT) {
    return { left: null, right: null, added: 0, removed: 0, gaveUp: true };
  }

  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const left = new Array(a.length).fill('same');
  const right = new Array(b.length).fill('same');
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (table[i + 1][j] >= table[i][j + 1]) {
      left[i] = 'removed'; removed += 1; i += 1;
    } else {
      right[j] = 'added'; added += 1; j += 1;
    }
  }
  while (i < a.length) { left[i] = 'removed'; removed += 1; i += 1; }
  while (j < b.length) { right[j] = 'added'; added += 1; j += 1; }

  return { left, right, added, removed, gaveUp: false };
}
