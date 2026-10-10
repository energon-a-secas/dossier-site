/**
 * Numstat adapter: git diff --numstat and --name-status
 *
 * Parses added/removed line counts per file into a files block and a
 * metrics block of totals.
 *
 * Pure, DOM-free.
 */

/**
 * @param {string} source
 * @returns {{ document: Document|null, findings: Array }}
 */
export function toDossier(source) {
  const findings = [];

  if (!source || typeof source !== 'string') {
    return { document: null, findings };
  }

  const lines = source.trim().split('\n');
  const items = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    const match = line.match(/^(\d+|\-)\s+(\d+|\-)\s+(.+)$/);
    if (!match) continue;

    const added = match[1] === '-' ? undefined : parseInt(match[1], 10);
    const removed = match[2] === '-' ? undefined : parseInt(match[2], 10);
    const path = match[3];

    const item = { path };

    if (added !== undefined) {
      item.added = added;
      totalAdded += added;
    }
    if (removed !== undefined) {
      item.removed = removed;
      totalRemoved += removed;
    }

    if (path.includes(' => ')) {
      const parts = path.split(' => ');
      item.from = parts[0].trim();
      item.path = parts[1].trim();
      item.state = 'renamed';
    } else if (added === 0 && removed > 0) {
      item.state = 'removed';
    } else if (added > 0 && removed === 0) {
      item.state = 'added';
    } else {
      item.state = 'modified';
    }

    items.push(item);
  }

  const document = {
    dossier: {
      version: 1,
      title: 'Git changes',
      pages: [
        {
          title: 'Changes',
          blocks: [
            {
              type: 'files',
              title: 'Files touched',
              items,
            },
            {
              type: 'metrics',
              title: 'Summary',
              items: [
                { label: 'Files changed', value: items.length, unit: 'files' },
                { label: 'Lines added', value: totalAdded, unit: 'lines' },
                { label: 'Lines removed', value: totalRemoved, unit: 'lines' },
              ],
            },
          ],
        },
      ],
    },
  };

  return { document, findings };
}
