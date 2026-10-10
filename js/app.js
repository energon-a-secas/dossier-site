// ── Entry point ──────────────────────────────────────────────
// Imports and starts. Everything it needs is in js/boot.js, so this file
// stays small enough to read in one glance and never accumulates logic.

import { state } from './state.js';
import { boot } from './boot.js';

boot(state).catch((err) => {
  // Booting is the one place with nothing above it to catch a failure, and a
  // blank page with a clean console is the worst outcome available here.
  // eslint-disable-next-line no-console
  console.error('Dossier could not start', err);
  const stage = document.getElementById('stage');
  if (stage) {
    stage.textContent = 'Dossier could not start. The console has the reason.';
  }
});
