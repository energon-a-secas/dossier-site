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
    const def = blockDef(block.type);
    // A block with a title of its own keeps its type in sight, since the
    // form's legend (the type) is for assistive technology only.
    const type = block.title && block.title !== def.name ? def.name : '';
    host.append(section(`${index + 1}. ${block.title || def.name}`, () =>
      blockForm(block.type, block, (next) => {
        const latest = reportOf(state.model);
        const pages = latest.pages.map((p) => p.id === page.id
          ? { ...p, blocks: p.blocks.map((b, i) => i === index ? next : b) }
          : p);
        onChange({ dossier: { ...latest, pages } });
      }), false, type));
  });
  return host;
}

function section(label, build, open = false, type = '') {
  const details = document.createElement('details');
  details.className = 'ds-form-section';
  details.open = open;
  const summary = document.createElement('summary');
  const name = document.createElement('span');
  name.textContent = label;
  summary.appendChild(name);
  if (type) {
    const kind = document.createElement('span');
    kind.className = 'ds-form-section__type';
    kind.textContent = type;
    summary.appendChild(kind);
  }
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
