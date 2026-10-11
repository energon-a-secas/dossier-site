/**
 * Form generation from registry field descriptors.
 *
 * Every block type gets a form built from its registry entry, so adding a
 * block type is one registry entry, not an edit to five switch statements.
 * Never renders derived fields as inputs; they are computed and shown as
 * read-only lines instead.
 */

import { escHtml, uid } from './neorgon-dom.js';
import { blockDef, derivedFields, META } from './registry/index.js';

/**
 * Generate a form for editing a block of a given type.
 *
 * @param {string} type block type id
 * @param {object} value current block value
 * @param {function} onChange called with (newValue) when any field changes
 * @returns {HTMLElement} a fieldset containing the form controls
 */
export function blockForm(type, value = {}, onChange = () => {}) {
  let current = { ...value };
  const def = blockDef(type);
  if (!def) return createErrorFieldset('Unknown block type');

  const fs = document.createElement('fieldset');
  fs.className = 'block-form';

  const legend = document.createElement('legend');
  legend.textContent = def.name;
  fs.appendChild(legend);

  const derived = derivedFields(type);
  const fields = def.fields || {};

  for (const [name, fieldDef] of Object.entries(fields)) {
    if (fieldDef?.derived) {
      const derivedValue = value[name];
      if (derivedValue !== undefined) {
        const container = document.createElement('div');
        container.className = 'form-derived-field';
        const label = document.createElement('label');
        label.textContent = humanLabel(name);
        const valueEl = document.createElement('div');
        valueEl.className = 'derived-value';
        valueEl.textContent = formatValue(derivedValue);
        const note = document.createElement('small');
        note.className = 'derived-note';
        note.textContent = 'Computed automatically';
        container.appendChild(label);
        container.appendChild(valueEl);
        container.appendChild(note);
        fs.appendChild(container);
      }
      continue;
    }

    const control = createControl(
      name,
      fieldDef,
      value[name],
      (newVal) => {
        current = { ...current, [name]: newVal };
        onChange(current);
      }
    );
    if (control) fs.appendChild(control);
  }

  return fs;
}

/**
 * Generate a form for editing document metadata.
 *
 * @param {object} model the parsed document model
 * @param {function} onChange called with (newMeta) when any field changes
 * @returns {HTMLElement} a fieldset containing the metadata form
 */
export function metaForm(input = {}, onChange = () => {}) {
  const fs = document.createElement('fieldset');
  fs.className = 'meta-form';

  const legend = document.createElement('legend');
  legend.textContent = 'Document properties';
  fs.appendChild(legend);

  // Accept the wrapped document or the report inside it. The caller had the
  // unwrapped report and this function looked for `.dossier` on it, so every
  // field rendered blank over a report that had a title all along.
  const wrapped = input && typeof input === 'object' && input.dossier && typeof input.dossier === 'object';
  let meta = { ...(wrapped ? input.dossier : (input || {})) };

  // The field descriptors come from the registry rather than a copy kept here.
  // The copy had already drifted: it offered six fields while the format has
  // eleven, so period, source and chrome could not be edited at all.
  const skip = new Set(['pages', 'version']);

  for (const [name, fieldDef] of Object.entries(META)) {
    if (skip.has(name)) continue;
    const control = createControl(
      name,
      fieldDef,
      meta[name],
      (newVal) => {
        meta = { ...meta, [name]: newVal };
        onChange(wrapped ? { ...input, dossier: meta } : meta);
      },
    );
    if (control) fs.appendChild(control);
  }

  return fs;
}

/**
 * Create a single form control for a field.
 *
 * @private
 */
function createControl(name, fieldDef, value, onChange) {
  if (typeof fieldDef === 'string') fieldDef = { type: fieldDef };
  const { type, note, maxLen, required, values: enumValues, of, fields: objFields, min, max } = fieldDef;

  const container = document.createElement('div');
  container.className = 'form-field';

  const labelId = uid('label-');
  const label = document.createElement('label');
  label.htmlFor = labelId;
  label.textContent = humanLabel(name);
  if (required) {
    const mark = document.createElement('span');
    mark.className = 'required-mark';
    mark.textContent = '*';
    mark.setAttribute('aria-label', 'required');
    label.appendChild(mark);
  }
  container.appendChild(label);

  let control;

  if (type === 'string') {
    control = document.createElement('input');
    control.type = 'text';
    control.id = labelId;
    control.value = value || '';
    if (maxLen) control.maxLength = maxLen;
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      onChange(e.target.value || undefined);
    });
  } else if (type === 'text') {
    control = document.createElement('textarea');
    control.id = labelId;
    control.value = value || '';
    if (maxLen) control.setAttribute('maxlength', maxLen);
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      onChange(e.target.value || undefined);
    });
  } else if (type === 'number') {
    control = document.createElement('input');
    control.type = 'number';
    control.id = labelId;
    control.value = value !== undefined ? value : '';
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      const v = e.target.value;
      onChange(v === '' ? undefined : parseFloat(v));
    });
  } else if (type === 'integer') {
    control = document.createElement('input');
    control.type = 'number';
    control.step = '1';
    control.id = labelId;
    control.value = value !== undefined ? value : '';
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      const v = e.target.value;
      onChange(v === '' ? undefined : parseInt(v, 10));
    });
  } else if (type === 'boolean') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.id = labelId;
    control.checked = !!value;
    control.addEventListener('change', (e) => {
      onChange(e.target.checked || undefined);
    });
  } else if (type === 'enum') {
    control = document.createElement('select');
    control.id = labelId;
    if (required) control.required = true;

    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = 'Select...';
    control.appendChild(blankOption);

    for (const v of (enumValues || [])) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = String(v);
      if (v === value) opt.selected = true;
      control.appendChild(opt);
    }

    control.addEventListener('change', (e) => {
      onChange(e.target.value || undefined);
    });
  } else if (type === 'url') {
    control = document.createElement('input');
    control.type = 'url';
    control.id = labelId;
    control.value = value || '';
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      onChange(e.target.value || undefined);
    });
  } else if (type === 'date') {
    control = document.createElement('input');
    control.type = 'date';
    control.id = labelId;
    control.value = value || '';
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      onChange(e.target.value || undefined);
    });
  } else if (type === 'array') {
    const arrayContainer = document.createElement('div');
    arrayContainer.className = 'array-field';
    control = arrayContainer;

    const items = Array.isArray(value) ? [...value] : [];
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'array-items';

    const updateArray = (newItems) => {
      onChange(newItems.length > 0 ? newItems : undefined);
    };

    const renderItems = () => {
      itemsContainer.replaceChildren();
      items.forEach((item, idx) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'array-item';

        const itemControl = createControl(
          `item-${idx}`,
          of,
          item,
          (newVal) => {
            items[idx] = newVal;
            updateArray([...items]);
          }
        );

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'array-remove-btn';
        removeBtn.setAttribute('aria-label', `Remove item ${idx + 1}`);
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
          items.splice(idx, 1);
          renderItems();
          updateArray([...items]);
        });

        itemEl.appendChild(itemControl);
        itemEl.appendChild(removeBtn);
        itemsContainer.appendChild(itemEl);
      });
    };

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'array-add-btn';
    addBtn.textContent = `Add ${humanLabel(name)}`;
    addBtn.addEventListener('click', () => {
      items.push(null);
      renderItems();
      updateArray([...items]);
    });

    renderItems();
    arrayContainer.appendChild(itemsContainer);
    arrayContainer.appendChild(addBtn);
  } else if (type === 'object') {
    const objContainer = document.createElement('fieldset');
    objContainer.className = 'object-field';
    control = objContainer;

    const objLegend = document.createElement('legend');
    objLegend.textContent = humanLabel(name);
    objContainer.appendChild(objLegend);

    const objValue = (typeof value === 'object' && value !== null) ? { ...value } : {};
    for (const [objFieldName, objFieldDef] of Object.entries(objFields || {})) {
      const objControl = createControl(
        objFieldName,
        objFieldDef,
        objValue[objFieldName],
        (newVal) => {
          objValue[objFieldName] = newVal;
          onChange({ ...objValue });
        }
      );
      if (objControl) objContainer.appendChild(objControl);
    }
  } else if (['any', 'block', 'evidence-item'].includes(type)) {
    control = document.createElement('textarea');
    control.id = labelId;
    control.value = JSON.stringify(value ?? null, null, 2);
    control.spellcheck = false;
    control.setAttribute('aria-label', `${humanLabel(name)} as JSON`);
    control.addEventListener('input', () => {
      try {
        const next = JSON.parse(control.value);
        control.setCustomValidity('');
        onChange(next);
      } catch {
        control.setCustomValidity('Enter a valid JSON value.');
      }
    });
  } else {
    return null;
  }

  if (control && control !== container) {
    container.appendChild(control);
  }

  if (note && type !== 'boolean') {
    const helpText = document.createElement('small');
    helpText.className = 'help-text';
    helpText.textContent = note;
    container.appendChild(helpText);
  }

  return container;
}

/**
 * Helper to create error fieldset.
 *
 * @private
 */
function createErrorFieldset(message) {
  const fs = document.createElement('fieldset');
  fs.className = 'form-error';
  const legend = document.createElement('legend');
  legend.textContent = 'Error';
  fs.appendChild(legend);
  const msg = document.createElement('p');
  msg.textContent = message;
  fs.appendChild(msg);
  return fs;
}

/**
 * Convert field name to human-readable label.
 *
 * @private
 */
function humanLabel(name) {
  return name
    .split(/(?=[A-Z])/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a value for display.
 *
 * @private
 */
function formatValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) return `[${val.length} item${val.length !== 1 ? 's' : ''}]`;
  if (typeof val === 'object') return '[object]';
  return String(val);
}
