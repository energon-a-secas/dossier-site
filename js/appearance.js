/* Run before styles paint, then bind the visible theme control once it exists. */
(() => {
  const key = 'dossier-site:appearance';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Session-only choice. */ }

  function apply() {
    const dark = preference === 'dark' || (preference !== 'light' && system.matches);
    root.dataset.appearance = dark ? 'dark' : 'light';
    document.getElementById('toggleAppearance')?.setAttribute('aria-pressed', String(dark));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17171f' : '#f3f4f7');
  }

  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('toggleAppearance')?.addEventListener('click', () => {
      preference = root.dataset.appearance === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch { /* Keep the session choice. */ }
      apply();
    });
  }, { once: true });
  system.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue;
    apply();
  });
})();
