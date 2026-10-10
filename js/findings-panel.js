/**
 * Findings panel: render validation and parse findings.
 *
 * Grouped by page, then by level (errors first). The count goes in the header
 * so a clipped list still says how much it clipped. Each finding links to its
 * block by path, scrolling it into view and marking it.
 */

import { escHtml } from './neorgon-dom.js';

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
        const findingEl = document.createElement('div');
        findingEl.className = `finding finding-${finding.level}`;
        if (finding.path) findingEl.style.cursor = 'pointer';

        const messageEl = document.createElement('div');
        messageEl.className = 'finding-message';
        messageEl.textContent = finding.message;
        findingEl.appendChild(messageEl);

        if (finding.rule) {
          const ruleEl = document.createElement('small');
          ruleEl.className = 'finding-rule';
          ruleEl.textContent = finding.rule;
          findingEl.appendChild(ruleEl);
        }

        if (finding.path) {
          findingEl.addEventListener('click', () => {
            onFindingClick(finding);
          });
        }

        levelGroup.appendChild(findingEl);
      }
    }
  }

  return container;
}

/**
 * Update findings in an existing panel.
 *
 * @param {HTMLElement} panel the panel element
 * @param {array} findings array of Finding objects
 * @param {function} onFindingClick called when a finding is clicked
 */
export function updateFindingsPanel(panel, findings = [], onFindingClick = () => {}) {
  const newPanel = createFindingsPanel({ findings, onFindingClick });
  panel.replaceWith(newPanel);
  return newPanel;
}
