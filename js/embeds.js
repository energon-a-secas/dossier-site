/** Send markup only to the specific sandboxed frame that requested it. */
export function bindEmbeds() {
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'dossier-embed-ready') return;
    for (const frame of document.querySelectorAll('iframe[data-embed-html]')) {
      if (frame.contentWindow !== event.source || frame.dataset.embedLoaded) continue;
      frame.dataset.embedLoaded = 'true';
      // Opaque origins require '*'; the WindowProxy identity binds this payload.
      frame.contentWindow.postMessage({ type: 'dossier-embed-content', html: frame.dataset.embedHtml }, '*');
      break;
    }
  });
}
