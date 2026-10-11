/** Preserve a complete HTML artifact, including its head, styles and SVGs. */
export function toDossier(source) {
  if (typeof source !== 'string' || !source.trim()) return { document: null, findings: [] };

  let title = 'Imported HTML report';
  if (typeof document !== 'undefined') {
    // Template contents stay inert, including images and resource hints.
    const template = document.createElement('template');
    template.innerHTML = source;
    title = (template.content.querySelector('title')?.textContent || template.content.querySelector('h1')?.textContent || title)
      .replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  const scripts = /<script\b|\son[a-z]+\s*=/i.test(source);

  return {
    document: {
      dossier: {
        version: 1,
        title,
        subtitle: 'Imported HTML · original layout',
        pages: [{
          title: 'HTML report',
          blocks: [{ type: 'embed', html: source, scripts }],
        }],
      },
    },
    findings: [],
  };
}
