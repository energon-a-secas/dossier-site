/** Forms edit the current report, never an earlier snapshot of another block. */
import { metaForm, blockForm } from './forms.js';
import { reportOf } from './render/model.js';
import { blockDef } from './registry/index.js';

export function reportForm(state, onChange) {
  const host = document.createElement('div');
  const report = reportOf(state.model);
  if (!report) return host;

  host.append(section('Report details', () => metaForm(state.model, (next) => {
    const latest = reportOf(state.model);
    onChange({ dossier: { ...reportOf(next), pages: latest.pages } });
  }), true));

  const page = report.pages.find((p) => p.id === state.page) || report.pages[0];
  if (!page) return host;
  const heading = document.createElement('h3');
  heading.className = 'ds-form-heading';
  heading.textContent = `Blocks in ${page.title}`;
  host.appendChild(heading);

  page.blocks.forEach((block, index) => {
    if (!block || !blockDef(block.type)) return;
    host.append(section(`${index + 1}. ${block.title || blockDef(block.type).name}`, () =>
      blockForm(block.type, block, (next) => {
        const latest = reportOf(state.model);
        const pages = latest.pages.map((p) => p.id === page.id
          ? { ...p, blocks: p.blocks.map((b, i) => i === index ? next : b) }
          : p);
        onChange({ dossier: { ...latest, pages } });
      })
    ));
  });
  return host;
}

function section(label, build, open = false) {
  const details = document.createElement('details');
  details.className = 'ds-form-section';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  let mounted = false;
  const mount = () => {
    if (mounted || !details.open) return;
    details.appendChild(build());
    mounted = true;
  };
  details.addEventListener('toggle', mount);
  mount();
  return details;
}
