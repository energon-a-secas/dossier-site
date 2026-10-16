/**
 * Findings panel: render validation and parse findings.
 *
 * Grouped by page, then by level (errors first). The count goes in the header
 * so a clipped list still says how much it clipped. A finding whose path
 * names a place in the report (`findingPlace`) is a button that takes the
 * reader there (js/source-pane.js gotoFinding); any other finding is text.
 */

/**
 * Where a finding's path points in the rendered report.
 *
 * `dossier.pages[2].blocks[4].field` is a block, `dossier.pages[2]` a page, and
 * a document field such as `dossier.subtitle` is the report header. A path
 * with no place (none, the bare document, a parse position) gives null, and
 * such a finding is not a button: it used to be one that did nothing.
 *
 * @param {string|null|undefined} path
 * @returns {{page: number, block: number|null}|{header: true}|null}
 */
export function findingPlace(path) {
  const text = String(path || '');
  const m = /pages\[(\d+)\](?:\.blocks\[(\d+)\])?/.exec(text);
  if (m) return { page: Number(m[1]), block: m[2] === undefined ? null : Number(m[2]) };
  if (/^dossier\.[A-Za-z]/.test(text)) return { header: true };
  return null;
}

/**
 * Create a findings panel.
 *
 * @param {object} opts configuration
 *   - findings array of Finding objects: { level, message, path, page, rule }
 *   - onFindingClick(finding) called when a finding is clicked
 * @returns {HTMLElement} the panel container
 */
export function createFindingsPanel(opts = {}) {
  const { findings = [], onFindingClick = () => {} } = opts;

  const container = document.createElement('div');
  container.className = 'findings-panel';

  const header = document.createElement('div');
  header.className = 'findings-header';
  container.appendChild(header);

  const title = document.createElement('h3');
  title.className = 'findings-title';
  title.textContent = 'Validation';
  header.appendChild(title);

  const count = document.createElement('span');
  count.className = 'findings-count';
  const errorCount = findings.filter((f) => f.level === 'error').length;
  const warnCount = findings.filter((f) => f.level === 'warn').length;
  const infoCount = findings.filter((f) => f.level === 'info').length;

  let countText = [];
  if (errorCount > 0) countText.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
  if (warnCount > 0) countText.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);
  if (infoCount > 0) countText.push(`${infoCount} note${infoCount !== 1 ? 's' : ''}`);

  if (countText.length === 0) {
    count.textContent = 'No issues';
    count.className = 'findings-count clean';
  } else {
    count.textContent = countText.join(', ');
  }
  header.appendChild(count);

  const content = document.createElement('div');
  content.className = 'findings-content';
  container.appendChild(content);

  if (findings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'findings-empty';
    empty.innerHTML = '<p>Document is clean. No errors or warnings.</p>';
    content.appendChild(empty);
    return container;
  }

  const groupedByPage = new Map();
  for (const finding of findings) {
    const page = finding.page || '(general)';
    if (!groupedByPage.has(page)) {
      groupedByPage.set(page, []);
    }
    groupedByPage.get(page).push(finding);
  }

  for (const [page, pageFindings] of groupedByPage) {
    const pageSection = document.createElement('div');
    pageSection.className = 'findings-page-group';
    content.appendChild(pageSection);

    const pageTitle = document.createElement('h4');
    pageTitle.className = 'findings-page-title';
    pageTitle.textContent = page;
    pageSection.appendChild(pageTitle);

    const levelOrder = ['error', 'warn', 'info'];
    const groupedByLevel = new Map();
    for (const level of levelOrder) {
      const levelFindings = pageFindings.filter((f) => f.level === level);
      if (levelFindings.length > 0) {
        groupedByLevel.set(level, levelFindings);
      }
    }

    for (const [level, levelFindings] of groupedByLevel) {
      const levelGroup = document.createElement('div');
      levelGroup.className = `findings-level-group findings-level-${level}`;
      pageSection.appendChild(levelGroup);

      for (const finding of levelFindings) {
        // A finding that names a place goes there, so it is a real button:
        // it was a clickable div, which a keyboard could not reach.
        const goes = Boolean(findingPlace(finding.path));
        const findingEl = document.createElement(goes ? 'button' : 'div');
        findingEl.className = `finding finding-${finding.level}`;
        if (goes) {
          findingEl.type = 'button';
          findingEl.title = 'Show this in the report';
          // Button defaults that the row style does not reset yet.
          Object.assign(findingEl.style, {
            display: 'block', width: '100%', textAlign: 'start', fontFamily: 'inherit', cursor: 'pointer',
          });
          findingEl.addEventListener('click', () => onFindingClick(finding));
        }

        const messageEl = document.createElement(goes ? 'span' : 'div');
        messageEl.className = 'finding-message';
        if (goes) messageEl.style.display = 'block';
        messageEl.textContent = finding.message;
        findingEl.appendChild(messageEl);

        if (finding.rule) {
          const ruleEl = document.createElement('small');
          ruleEl.className = 'finding-rule';
          ruleEl.textContent = finding.rule;
          findingEl.appendChild(ruleEl);
        }

        levelGroup.appendChild(findingEl);
      }
    }
  }

  return container;
}

/**
 * Redraw the panel with new findings.
 *
 * Returns the new panel, which replaces the old one in the page. Keep the
 * returned node: the old one is detached, and replacing it again does nothing.
 *
 * @param {HTMLElement|null} panel the current panel, or null for none
 * @param {array} findings array of Finding objects
 * @param {function} onFindingClick called when a finding is chosen
 * @returns {HTMLElement} the new panel
 */
export function updateFindingsPanel(panel, findings = [], onFindingClick = () => {}) {
  const newPanel = createFindingsPanel({ findings, onFindingClick });
  if (panel && panel.isConnected) panel.replaceWith(newPanel);
  return newPanel;
}
