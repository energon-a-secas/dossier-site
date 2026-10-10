/**
 * Commits adapter: parse Conventional Commits 1.0.0 from git log output
 *
 * Groups by type into a timeline block plus a kv of counts.
 *
 * One regex for the commit format.
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
  const commits = [];
  const typeMap = {};

  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore)(\(.+?\))?(!)?:\s+(.+)$/;

  for (const line of lines) {
    if (!line.trim()) continue;

    const match = line.match(conventionalRegex);
    if (match) {
      const [, type, scope, breaking, message] = match;
      const fullMessage = `${type}${scope || ''}${breaking ? '!' : ''}: ${message}`;

      commits.push({
        type,
        scope: scope ? scope.substring(1, scope.length - 1) : undefined,
        breaking: !!breaking,
        message,
        fullMessage,
      });

      typeMap[type] = (typeMap[type] || 0) + 1;
    }
  }

  const timeline = commits.map((commit, i) => ({
    date: undefined,
    title: commit.message,
    note: commit.scope ? `${commit.type}(${commit.scope})` : commit.type,
  }));

  const kvItems = Object.entries(typeMap).map(([type, count]) => ({
    label: type,
    value: count,
  }));

  const document = {
    dossier: {
      version: 1,
      title: 'Commits',
      pages: [
        {
          title: 'Changes',
          blocks: [
            {
              type: 'timeline',
              title: 'Commits',
              items: timeline,
            },
            {
              type: 'kv',
              title: 'By type',
              items: kvItems,
            },
          ],
        },
      ],
    },
  };

  return { document, findings };
}
