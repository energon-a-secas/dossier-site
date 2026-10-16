/**
 * Form generation from registry field descriptors.
 *
 * Every block type gets a form built from its registry entry, so adding a
 * block type is one registry entry, not an edit to five switch statements.
 * Never renders derived fields as inputs; they are computed and shown as
 * read-only lines instead.
 */

import { uid } from './neorgon-dom.js';
import { blockDef, derivedFields, META } from './registry/index.js';
import { enumWord } from './render/format.js';

// ── Words a reader uses ──────────────────────────────────────────────────────
// The form names every field once, in the reader's words. The registry's
// field names and enum values are the format's words ("chrome", "in-review"),
// written to the document as they are; only the text people see changes.

/** Field names whose sentence-case spelling is not what a reader calls them. */
const FIELD_LABELS = { chrome: 'Opens in', href: 'Link', src: 'Image address', alt: 'Alt text' };
/** What one item of a list field is called, where dropping an "s" is wrong. */
const ITEM_NOUNS = {
  axes: 'Axis', criteria: 'Criterion', categories: 'Category', series: 'Series', evidence: 'Source',
  spark: 'Point', highlight: 'Line', grid: 'Row', rows: 'Row',
};
/** Option words for fields whose values mean something particular there. */
const FIELD_OPTIONS = {
  chrome: { auto: "Reader's last choice", hidden: 'Reading', shown: 'Editing' },
  checkedBy: { code: 'A machine', human: 'A person', llm: 'A model', none: 'Nobody' },
};
/**
 * Help that replaces the registry note in the form only: the registry's note
 * quotes the raw values, and it also feeds schema.json, where they belong.
 */
const FIELD_NOTES = {
  chrome: "How the report opens for someone who receives it. Reader's last choice keeps their own setting.",
};

/** A field name as a label: "checkedBy" reads "Checked by", "why_not" reads "Why not". */
export function fieldLabel(name) {
  const raw = String(name ?? '');
  if (Object.hasOwn(FIELD_LABELS, raw)) return FIELD_LABELS[raw];
  const words = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What one item of the list field `arrayName` is called: "tags" gives "Tag". */
function itemNoun(arrayName) {
  const raw = String(arrayName ?? '');
  if (Object.hasOwn(ITEM_NOUNS, raw)) return ITEM_NOUNS[raw];
  const label = fieldLabel(raw);
  return /[^s]s$/.test(label) ? label.slice(0, -1) : label;
}

/** An item's label: "Tag 1", "Criterion 2", "Source 1". */
export function itemLabel(arrayName, index) {
  return `${itemNoun(arrayName)} ${index + 1}`;
}

/** An enum value as an option's text: the field's own word, else the renderer's. */
export function optionLabel(fieldName, value) {
  const words = Object.hasOwn(FIELD_OPTIONS, fieldName) ? FIELD_OPTIONS[fieldName] : null;
  if (words && Object.hasOwn(words, value)) return words[value];
  return enumWord(value);
}

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

  // The section's summary already names the block, so the legend is for
  // assistive technology only: the group keeps its name, the eye sees it once.
  const legend = document.createElement('legend');
  legend.className = 'sr-only';
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
        label.textContent = fieldLabel(name);
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

  // Named by its section's summary, "Report details", on screen.
  const legend = document.createElement('legend');
  legend.className = 'sr-only';
  legend.textContent = 'Report details';
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
 * Create a single form control for a field, labelled `label`. A scalar is a
 * `.form-field` with a `<label for>`; an object or a list is a fieldset whose
 * legend is its name, with no label of its own (a label pointing at a
 * fieldset labels nothing).
 *
 * @private
 * @param {{itemNoun?: string}} [opts] what this list's items are called, when
 *   the list is itself an item ("Cell" for the rows of a table)
 */
function createControl(name, fieldDef, value, onChange, label = fieldLabel(name), opts = {}) {
  if (typeof fieldDef === 'string') fieldDef = { type: fieldDef };
  const { type, required, values: enumValues, of, fields: objFields } = fieldDef;
  const maxLen = fieldDef.maxLen;
  const note = Object.hasOwn(FIELD_NOTES, name) ? FIELD_NOTES[name] : fieldDef.note;

  if (type === 'object' || type === 'array') {
    const group = document.createElement('fieldset');
    group.className = type === 'object' ? 'object-field' : 'array-field';
    const legend = document.createElement('legend');
    legend.textContent = label;
    if (required) legend.appendChild(requiredMark());
    group.appendChild(legend);
    if (note) group.appendChild(helpText(note));
    if (type === 'object') objectBody(group, objFields, value, onChange);
    else arrayBody(group, name, of, value, onChange, opts.itemNoun || itemNoun(name));
    return group;
  }

  const container = document.createElement('div');
  container.className = 'form-field';
  const labelId = uid('label-');
  const labelEl = document.createElement('label');
  labelEl.htmlFor = labelId;
  labelEl.textContent = label;
  if (required) labelEl.appendChild(requiredMark());
  container.appendChild(labelEl);

  let control;
  const text = (el) => {
    el.id = labelId;
    el.value = value || '';
    if (required) el.required = true;
    el.addEventListener('input', (e) => onChange(e.target.value || undefined));
    return el;
  };
  const input = (kind) => {
    const el = document.createElement('input');
    el.type = kind;
    return el;
  };

  if (type === 'string') {
    control = text(input('text'));
    if (maxLen) control.maxLength = maxLen;
  } else if (type === 'text') {
    control = text(document.createElement('textarea'));
    if (maxLen) control.setAttribute('maxlength', maxLen);
  } else if (type === 'number' || type === 'integer') {
    control = input('number');
    if (type === 'integer') control.step = '1';
    control.id = labelId;
    control.value = value !== undefined ? value : '';
    if (required) control.required = true;
    control.addEventListener('input', (e) => {
      const v = e.target.value;
      onChange(v === '' ? undefined : (type === 'integer' ? parseInt(v, 10) : parseFloat(v)));
    });
  } else if (type === 'boolean') {
    control = input('checkbox');
    control.id = labelId;
    control.checked = !!value;
    control.addEventListener('change', (e) => onChange(e.target.checked || undefined));
  } else if (type === 'enum') {
    control = document.createElement('select');
    control.id = labelId;
    if (required) control.required = true;
    const blankOption = document.createElement('option');
    blankOption.value = '';
    blankOption.textContent = 'Not set';
    control.appendChild(blankOption);
    for (const v of (enumValues || [])) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = optionLabel(name, v);
      if (v === value) opt.selected = true;
      control.appendChild(opt);
    }
    control.addEventListener('change', (e) => onChange(e.target.value || undefined));
  } else if (type === 'url') {
    control = text(input('url'));
  } else if (type === 'date') {
    control = text(input('date'));
  } else if (['any', 'block', 'evidence-item'].includes(type)) {
    control = document.createElement('textarea');
    control.id = labelId;
    control.value = JSON.stringify(value ?? null, null, 2);
    control.spellcheck = false;
    control.setAttribute('aria-label', `${label} as JSON`);
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

  container.appendChild(control);
  if (note && type !== 'boolean') container.appendChild(helpText(note));
  return container;
}

function objectBody(group, objFields, value, onChange) {
  const objValue = (typeof value === 'object' && value !== null) ? { ...value } : {};
  for (const [objFieldName, objFieldDef] of Object.entries(objFields || {})) {
    const objControl = createControl(objFieldName, objFieldDef, objValue[objFieldName], (newVal) => {
      objValue[objFieldName] = newVal;
      onChange({ ...objValue });
    });
    if (objControl) group.appendChild(objControl);
  }
}

/** A list's items, each labelled "<noun> <n>", with Remove and Add buttons. */
function arrayBody(group, name, of, value, onChange, noun) {
  const items = Array.isArray(value) ? [...value] : [];
  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'array-items';
  const word = noun.toLowerCase();
  // An item that is itself a list (a table's row) holds cells.
  const innerOpts = (typeof of === 'object' && of?.type === 'array') || of === 'array' ? { itemNoun: 'Cell' } : {};
  const updateArray = (newItems) => onChange(newItems.length > 0 ? newItems : undefined);

  const renderItems = () => {
    itemsContainer.replaceChildren();
    items.forEach((item, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'array-item';
      const itemControl = createControl(name, of, item, (newVal) => {
        items[idx] = newVal;
        updateArray([...items]);
      }, `${noun} ${idx + 1}`, innerOpts);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'array-remove-btn';
      removeBtn.setAttribute('aria-label', `Remove ${word} ${idx + 1}`);
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        items.splice(idx, 1);
        renderItems();
        updateArray([...items]);
      });
      if (itemControl) itemEl.appendChild(itemControl);
      itemEl.appendChild(removeBtn);
      itemsContainer.appendChild(itemEl);
    });
  };

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'array-add-btn';
  addBtn.textContent = `Add ${word}`;
  addBtn.addEventListener('click', () => {
    items.push(null);
    renderItems();
    updateArray([...items]);
  });

  renderItems();
  group.appendChild(itemsContainer);
  group.appendChild(addBtn);
}

/** The required star: seen, not read, so a group's name stays its bare label. */
function requiredMark() {
  const mark = document.createElement('span');
  mark.className = 'required-mark';
  mark.textContent = '*';
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function helpText(note) {
  const el = document.createElement('small');
  el.className = 'help-text';
  el.textContent = note;
  return el;
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
