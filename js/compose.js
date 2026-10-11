/** A response comparison is a regular report, so saving and sharing stay the same. */
export function comparisonDocument({ title, prompt, leftLabel, rightLabel, left, right }) {
  if (!String(left || '').trim() || !String(right || '').trim()) {
    throw new Error('Add text to both responses before comparing.');
  }
  return {
    dossier: {
      version: 1,
      title: String(title || '').trim() || 'Response comparison',
      subtitle: 'Two responses to review side by side. Highlights show differences, not a quality score.',
      kind: 'comparison',
      status: 'draft',
      pages: [{
        title: 'Responses',
        blocks: [{
          type: 'compare', kind: 'text', mode: 'side', highlightChanges: false,
          ...(String(prompt || '').trim() ? { prompt: String(prompt).trim() } : {}),
          left: { label: String(leftLabel || '').trim() || 'Response A', value: String(left) },
          right: { label: String(rightLabel || '').trim() || 'Response B', value: String(right) },
        }],
      }],
    },
  };
}

export function showComposer(show) {
  const panel = document.getElementById('comparisonComposer');
  if (!panel) return;
  panel.hidden = !show;
  document.body.classList.toggle('is-composing', show);
  if (show) panel.querySelector('[name="title"]')?.focus();
  else document.querySelector('[data-action="compose"]')?.focus();
}

export function bindComposer(onCreate) {
  const form = document.getElementById('comparisonForm');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    for (const name of ['left', 'right']) {
      const field = form.elements.namedItem(name);
      field.setCustomValidity(field.value.trim() ? '' : 'Paste a response to compare.');
    }
    if (!form.reportValidity()) return;
    onCreate(comparisonDocument(data));
    showComposer(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  form?.addEventListener('input', (event) => event.target.setCustomValidity?.(''));
}
