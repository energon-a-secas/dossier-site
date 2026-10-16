/**
 * Commits adapter: parse Conventional Commits 1.0.0 from git log output
 *
 * One table row per commit (type, scope, change, breaking) plus a facts block
 * of counts per type. One regex for the commit format.
 *
 * This used to emit a timeline whose items carried `title`, `note` and an
 * undefined `date`, none of which a timeline item has, so every row rendered
 * blank, and a facts block whose values were numbers where the format wants
 * text. A one-line log has no times to put on a timeline, and a timeline needs
 * at least two entries, so the commits are a table: it holds one row or two
 * thousand and sorts by type.
 *
 * Pure, DOM-free.
 */

const COMMIT = /^(feat|fix|docs|style|refactor|perf|test|chore)(\(.+?\))?(!)?:\s+(.+)$/;
const MAX_ROWS = 2000;

/**
 * @param {string} source
 * @returns {{ document: Document|null, findings: Array }}
 */
export function toDossier(source) {
  const findings = [];

  if (!source || typeof source !== 'string') {
    return { document: null, findings };
  }

  const rows = [];
  const typeMap = {};
  let total = 0;

  for (const line of source.replace(/\r\n?/g, '\n').trim().split('\n')) {
    const match = line.trim().match(COMMIT);
    if (!match) continue;
    const [, type, scope, breaking, message] = match;
    if (rows.length < MAX_ROWS) {
      rows.push([type, scope ? scope.slice(1, -1) : '', message, breaking ? 'yes' : '']);
    }
    typeMap[type] = (typeMap[type] || 0) + 1;
    total += 1;
  }

  if (total > rows.length) {
    findings.push({
      level: 'info',
      message: `Only the first ${MAX_ROWS} of ${total} commits are shown.`,
      path: '',
      page: null,
      rule: null,
    });
  }

  const blocks = rows.length === 0
    ? [{ type: 'prose', text: 'No Conventional Commits were found in this log.' }]
    : [
      {
        type: 'table',
        title: 'Commits',
        columns: [
          { label: 'Type' },
          { label: 'Scope' },
          { label: 'Change' },
          { label: 'Breaking' },
        ],
        rows,
      },
      {
        type: 'kv',
        title: 'By type',
        items: Object.entries(typeMap).map(([type, count]) => ({
          label: type,
          value: `${count} ${count === 1 ? 'commit' : 'commits'}`,
        })),
      },
    ];

  const document = {
    dossier: {
      version: 1,
      title: 'Commits',
      pages: [{ title: 'Changes', blocks }],
    },
  };

  return { document, findings };
}
