/**
 * Library on top of the store: a list of reports, the current one,
 * autosave, and import and export of files.
 *
 * A new report gets an id from uid(). Autosave is debounced and separate
 * from rendering. Editing produces a new revision rather than mutating
 * in place where that is cheap.
 */

import { uid, debounce, showToast } from './neorgon-dom.js';
import { listReports, readReport, writeReport, deleteReport } from './store.js';

export class Workspace {
  constructor() {
    this.reports = [];
    this.current = null;
    this.currentId = null;
    this.unsavedChanges = false;
    this.saveInProgress = false;
    this.listeners = new Set();
    this.debouncedSave = debounce(() => this.performSave(), 1000);
  }

  async init() {
    this.reports = await listReports();
    this.notifyListeners();
  }

  async loadReport(id) {
    if (this.unsavedChanges && this.current) {
      return new Promise((resolve) => {
        const dialog = document.createElement('dialog');
        dialog.innerHTML = `
          <div style="padding: 20px; font-family: sans-serif;">
            <h2>Unsaved changes</h2>
            <p>You have unsaved changes to the current report. Open a different one?</p>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
              <button id="discard">Discard</button>
              <button id="keep" autofocus>Keep editing</button>
            </div>
          </div>
        `;
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        dialog.querySelector('#discard').addEventListener('click', () => {
          dialog.remove();
          this.unsavedChanges = false;
          this.doLoadReport(id).then(resolve);
        });
        dialog.querySelector('#keep').addEventListener('click', () => {
          dialog.remove();
          resolve(false);
        });
      });
    }
    return this.doLoadReport(id);
  }

  async doLoadReport(id) {
    const result = await readReport(id);
    if (result) {
      this.current = result.document;
      this.currentId = id;
      this.unsavedChanges = false;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  newReport() {
    this.currentId = uid('doc-');
    this.current = {
      dossier: {
        version: '1.0.0',
        title: 'New Report',
        pages: [],
      },
    };
    this.unsavedChanges = true;
    this.notifyListeners();
  }

  editCurrent(updateFn) {
    if (!this.current) return;
    const updated = JSON.parse(JSON.stringify(this.current));
    updateFn(updated);
    this.current = updated;
    this.unsavedChanges = true;
    this.debouncedSave();
    this.notifyListeners();
  }

  async performSave() {
    if (!this.current || !this.currentId || this.saveInProgress) return;
    this.saveInProgress = true;
    try {
      const title = this.current.dossier?.title || 'Untitled';
      const kind = this.current.dossier?.kind || 'report';
      const status = this.current.dossier?.status || 'draft';
      const pages = this.current.dossier?.pages?.length || 0;
      let blocks = 0;
      if (this.current.dossier?.pages) {
        for (const page of this.current.dossier.pages) {
          blocks += page.blocks?.length || 0;
        }
      }
      const meta = { title, kind, status, pages, blocks };
      const saved = await writeReport(this.currentId, this.current, meta);
      if (saved) {
        this.unsavedChanges = false;
        await this.refreshList();
      } else {
        showToast('Could not save. Storage quota may be exceeded.');
      }
    } catch {
      showToast('Could not save. An error occurred.');
    } finally {
      this.saveInProgress = false;
    }
  }

  async deleteCurrentReport() {
    if (!this.currentId) return false;
    const ok = await deleteReport(this.currentId);
    if (ok) {
      this.current = null;
      this.currentId = null;
      this.unsavedChanges = false;
      await this.refreshList();
      return true;
    }
    return false;
  }

  async refreshList() {
    this.reports = await listReports();
    this.notifyListeners();
  }

  /**
   * Import a file by accepting text. Returns the text, does not parse it.
   * The caller (another module) does the parsing.
   *
   * @returns {Promise<string|null>}
   */
  async importFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.yaml,.yml,.md,.html,.xml,.sarif,.txt';
      input.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onload = () => {
          const text = reader.result;
          resolve(typeof text === 'string' ? text : null);
        };
        reader.readAsText(file);
      });
      input.click();
    });
  }

  /**
   * Handle dropped files.
   * @param {DataTransfer} dataTransfer
   * @returns {Promise<string|null>}
   */
  async handleDroppedFile(dataTransfer) {
    const files = dataTransfer.files;
    if (!files || files.length === 0) return null;
    const file = files[0];
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const text = reader.result;
        resolve(typeof text === 'string' ? text : null);
      };
      reader.readAsText(file);
    });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyListeners() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* silently ignore listener errors */
      }
    }
  }
}
