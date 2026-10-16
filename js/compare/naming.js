/**
 * A comparison is named after its reports until the reader names it.
 * DOM-free: node imports it.
 *
 * `reportTitle` reads the title a report gives itself: an HTML page's
 * <title> (from its head, never an SVG's <title> in its body) or first <h1>,
 * a Markdown file's front matter title or first level 1 heading, a Dossier
 * document's title, else the file's name without its extension. `followTitle`
 * applies it when a column gets a report: the set takes the title of its first
 * filled column while its title is still the default or that column's own,
 * so a title the reader typed is never replaced. No stored flag: a renamed set
 * simply never matches its automatic title.
 */

import { clampLine, LIMITS, setTitle, DEFAULT_TITLE } from './model.js';

const ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' });

/** A numeric reference's character, or the reference as written when it is not one. */
function codePoint(n, raw) {
  if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return raw;
  return String.fromCodePoint(n);
}

/** Decode the few entities a title uses; an unknown named one stays as written. */
function decodeEntities(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z]{2,8});/g, (raw, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      return codePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), raw);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body.toLowerCase()) ? ENTITIES[body.toLowerCase()] : raw;
  });
}

/** An element's text from markup: tags out, entities decoded, one line. */
function textOf(markup) {
  return decodeEntities(String(markup).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function htmlTitle(text) {
  const body = /<body[\s>]/i.exec(text);
  const head = body ? text.slice(0, body.index) : text;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const fromTitle = title ? textOf(title[1]) : '';
  if (fromTitle) return fromTitle;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
  return h1 ? textOf(h1[1]) : '';
}

function markdownTitle(text) {
  const body = String(text).replace(/^﻿/, '');
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
  if (front) {
    const line = /^title:[ \t]*(.+?)[ \t]*$/m.exec(front[1]);
    if (line) {
      const value = line[1].replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
      if (value) return value;
    }
  }
  const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
  if (!heading) return '';
  return heading[1]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

function dossierTitle(text) {
  try {
    const value = JSON.parse(text);
    const title = value?.dossier?.title ?? value?.title;
    return typeof title === 'string' ? title : '';
  } catch {
    return '';
  }
}

/** A file name without its extension, or '' for pasted text. */
function nameStem(name) {
  const clean = String(name || '').trim();
  if (!clean || clean === 'Pasted text') return '';
  return clean.replace(/\.[a-z0-9]{1,10}$/i, '');
}

/**
 * The title a source gives itself, one line, or ''.
 *
 * @param {{kind: string, name?: string, text: string}|null} source
 * @returns {string}
 */
export function reportTitle(source) {
  if (!source || typeof source.text !== 'string') return '';
  let title = '';
  if (source.kind === 'html') title = htmlTitle(source.text);
  else if (source.kind === 'markdown') title = markdownTitle(source.text);
  else if (source.kind === 'dossier') title = dossierTitle(source.text);
  return clampLine(title, LIMITS.title) || clampLine(nameStem(source.name), LIMITS.title);
}

/** The title of the first column, in set order, that holds a report, or ''. */
export function autoTitle(set) {
  const col = (set?.columns || []).find((c) => c.source);
  return col ? reportTitle(col.source) : '';
}

/**
 * `next`, titled after its first report when `before` was untitled or still
 * carried its first report's title; `next` unchanged once the reader named it.
 *
 * @param {object} before the set before the change
 * @param {object} next the set after it
 */
export function followTitle(before, next) {
  const was = autoTitle(before);
  if (before.title !== DEFAULT_TITLE && !(was && before.title === was)) return next;
  return setTitle(next, autoTitle(next));
}
