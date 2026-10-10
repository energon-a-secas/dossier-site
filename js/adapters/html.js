/**
 * HTML adapter: parse HTML into Dossier blocks
 *
 * Two modes: wrap the whole thing as one embed block, and a best-effort
 * lift where <table> becomes a table block, headings become pages, and
 * <pre> becomes code.
 *
 * This is the only adapter allowed to use DOMParser, and it must parse
 * into an inert document, never into the live one. Both return objects,
 * the caller picks which to offer.
 *
 * Strips <script> from the embed payload and reports it.
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

  let doc;
  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      doc = parser.parseFromString(source, 'text/html');
    } else if (typeof require !== 'undefined') {
      try {
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM(source);
        doc = dom.window.document;
      } catch (e) {
        findings.push({
          level: 'warn',
          message: 'HTML parsing requires jsdom in Node environment',
          path: '',
          page: null,
          rule: null,
        });
        return { document: null, findings };
      }
    } else {
      findings.push({
        level: 'warn',
        message: 'HTML parsing not available in this environment',
        path: '',
        page: null,
        rule: null,
      });
      return { document: null, findings };
    }
  } catch (e) {
    findings.push({
      level: 'error',
      message: `HTML parse error: ${e.message}`,
      path: '',
      page: null,
      rule: null,
    });
    return { document: null, findings };
  }

  const body = doc.body || doc.documentElement;
  let htmlContent = body.innerHTML;

  const scriptCount = (htmlContent.match(/<script/gi) || []).length;
  if (scriptCount > 0) {
    htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    findings.push({
      level: 'info',
      message: `Stripped ${scriptCount} script tag(s) from HTML. Scripts are never loaded in dossier.`,
      path: '',
      page: null,
      rule: null,
    });
  }

  const embedDocument = {
    dossier: {
      version: 1,
      title: 'HTML content',
      pages: [{
        title: 'Embedded',
        blocks: [{
          type: 'embed',
          title: 'HTML',
          source: htmlContent,
        }],
      }],
    },
  };

  const liftedBlocks = [];
  if (body.children) {
    for (const child of body.children) {
      const blocks = liftElement(child);
      liftedBlocks.push(...blocks);
    }
  }

  let pages = [];
  let currentPage = null;
  let currentBlocks = [];

  for (const block of liftedBlocks) {
    if (block.type === 'heading' && block.level === 1) {
      if (currentPage) {
        currentPage.blocks = currentBlocks;
        pages.push(currentPage);
        currentBlocks = [];
      }
      currentPage = { title: block.text, blocks: [] };
    } else {
      currentBlocks.push(block);
    }
  }

  if (currentPage) {
    currentPage.blocks = currentBlocks;
    pages.push(currentPage);
  }

  if (pages.length === 0 && currentBlocks.length > 0) {
    pages = [{
      title: 'Content',
      blocks: currentBlocks,
    }];
  }

  const liftedDocument = pages.length > 0 ? {
    dossier: {
      version: 1,
      title: 'HTML content',
      pages,
    },
  } : embedDocument;

  return { document: liftedDocument, findings };
}

function liftElement(el) {
  const blocks = [];

  if (!el || !el.tagName) return blocks;

  const tag = el.tagName.toLowerCase();

  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
    const level = parseInt(tag[1], 10);
    blocks.push({
      type: 'heading',
      level,
      text: el.textContent?.trim() || '',
    });
  } else if (tag === 'p') {
    const text = el.textContent?.trim();
    if (text) {
      blocks.push({
        type: 'prose',
        text,
      });
    }
  } else if (tag === 'pre') {
    const code = el.textContent?.trim() || '';
    if (code) {
      blocks.push({
        type: 'code',
        source: code,
      });
    }
  } else if (tag === 'table') {
    const table = liftTable(el);
    if (table) blocks.push(table);
  } else if (tag === 'blockquote') {
    const text = el.textContent?.trim();
    if (text) {
      blocks.push({
        type: 'callout',
        note: text,
      });
    }
  } else if (tag === 'ul' || tag === 'ol') {
    const items = [];
    for (const li of el.querySelectorAll('li')) {
      const text = li.textContent?.trim();
      if (text) items.push(text);
    }
    if (items.length > 0) {
      blocks.push({
        type: 'prose',
        text: items.map((i) => `• ${i}`).join('\n'),
      });
    }
  } else if (el.children) {
    for (const child of el.children) {
      blocks.push(...liftElement(child));
    }
  }

  return blocks;
}

function liftTable(el) {
  const headers = [];
  const rows = [];

  const thead = el.querySelector('thead');
  if (thead) {
    for (const th of thead.querySelectorAll('th')) {
      headers.push({ label: th.textContent?.trim() || '' });
    }
  }

  if (headers.length === 0) {
    const firstRow = el.querySelector('tr');
    if (firstRow) {
      for (const cell of firstRow.querySelectorAll('td, th')) {
        headers.push({ label: cell.textContent?.trim() || '' });
      }
    }
    const tbody = el.querySelector('tbody') || el;
    for (const row of tbody.querySelectorAll('tr')) {
      const isFirst = row === firstRow;
      if (isFirst) continue;

      const cells = [];
      for (const cell of row.querySelectorAll('td, th')) {
        cells.push(cell.textContent?.trim() || '');
      }
      if (cells.length > 0) rows.push(cells);
    }
  } else {
    const tbody = el.querySelector('tbody');
    const rowsEl = tbody ? tbody.querySelectorAll('tr') : el.querySelectorAll('tr');
    let first = true;
    for (const row of rowsEl) {
      if (first && thead) { first = false; continue; }
      const cells = [];
      for (const cell of row.querySelectorAll('td, th')) {
        cells.push(cell.textContent?.trim() || '');
      }
      if (cells.length > 0) rows.push(cells);
    }
  }

  if (headers.length === 0 || rows.length === 0) return null;

  return {
    type: 'table',
    columns: headers,
    rows,
  };
}
