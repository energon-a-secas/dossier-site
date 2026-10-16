/** Self-contained so the same controls can travel with an offline HTML file. */
export function bindComparisons(root) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const comparison = button?.closest('.compare');
    if (!comparison) return;

    if (button.hasAttribute('data-compare-highlight')) {
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(enabled));
      comparison.dataset.highlight = enabled ? 'on' : 'off';
    }
    if (button.dataset.compareView) {
      const layout = button.dataset.compareView;
      comparison.dataset.layout = layout;
      comparison.classList.toggle('compare--side', layout === 'side');
      comparison.classList.toggle('compare--toggle', layout === 'toggle');
      for (const control of comparison.querySelectorAll('[data-compare-view]')) {
        control.setAttribute('aria-pressed', String(control.dataset.compareView === layout));
      }
      const switcher = comparison.querySelector('.compare__switch');
      if (switcher) switcher.hidden = layout === 'side';
      const selected = comparison.querySelector('[data-action="compare-toggle"][aria-pressed="true"]');
      showSide(comparison, selected?.dataset.side || 'left');
    }
    if (button.dataset.action === 'compare-toggle') showSide(comparison, button.dataset.side);
  });

  root.addEventListener('input', (event) => {
    const control = event.target.closest('[data-action="compare-wipe"], [data-action="compare-opacity"]');
    const comparison = control?.closest('.compare');
    if (!comparison) return;
    const value = Math.max(0, Math.min(100, Number(control.value) || 0));
    const wipe = control.dataset.action === 'compare-wipe';
    comparison.style.setProperty(wipe ? '--wipe' : '--fade', wipe ? `${value}%` : String(value / 100));
    // Say what the position means, not only the number. Replacing the initial
    // "Before on the left, After on the right" with a bare "50%" lost the one
    // thing a screen reader user needs to know about this control.
    const left = control.dataset.left || 'Before';
    const right = control.dataset.right || 'After';
    control.setAttribute('aria-valuetext', wipe
      ? `${value}% ${left} on the left, ${100 - value}% ${right} on the right`
      : `${right} at ${value}% over ${left}`);
  });

  function showSide(comparison, side) {
    for (const face of comparison.querySelectorAll('.compare__face')) {
      face.hidden = comparison.dataset.layout === 'toggle' && face.dataset.side !== side;
    }
    for (const control of comparison.querySelectorAll('[data-action="compare-toggle"]')) {
      control.setAttribute('aria-pressed', String(control.dataset.side === side));
    }
  }
}
