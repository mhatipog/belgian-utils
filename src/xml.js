// A small, safe XML parser shared by all XML tools (UBL/Peppol, CAMT, XBRL,
// Intervat, KMEHR, DmfA…). It never expands DTDs or external entities (so no
// XXE), reports errors with line/column, tracks namespaces, and offers
// namespace-agnostic lookups by local name plus pretty-printing and XML→JSON.

export class XmlError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(s, pos, where) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][\w.-]*);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { throw where(`Invalid character reference ${m}`, pos); }
    }
    if (e in ENT) return ENT[e];
    throw where(`Unknown entity ${m} (DTD entities are not expanded)`, pos);
  });
}

/**
 * Parse XML text into a tree of element nodes:
 *   { name, prefix, local, ns, attrs: {qname: value}, children: [node|string], line, col, parent }
 * Returns { root, declaration, comments }.
 */
export function parseXml(text) {
  let src = String(text);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const n = src.length;
  let i = 0;
  // Line starts for error positions.
  const lineStarts = [0];
  for (let k = 0; k < n; k++) if (src.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const locate = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: pos - lineStarts[lo] + 1 };
  };
  const fail = (msg, pos = i) => {
    const { line, col } = locate(pos);
    return new XmlError(msg, line, col);
  };

  let root = null;
  let declaration = null;
  const stack = [];
  const nsStack = [{ xml: 'http://www.w3.org/XML/1998/namespace', '': '' }];

  const NAME = /[A-Za-z_:À-￿][\w.\-:·À-￿]*/y;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      const tail = src.slice(i);
      if (tail.trim()) {
        if (!stack.length) throw fail('Text after the root element', i);
      }
      break;
    }
    if (lt > i) {
      const t = src.slice(i, lt);
      if (stack.length) stack[stack.length - 1].children.push(decodeEntities(t, i, fail));
      else if (t.trim()) throw fail(root ? 'Text after the root element' : 'Text before the root element', i);
    }
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) throw fail('Unclosed comment', i);
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) throw fail('Unclosed CDATA section', i);
      if (!stack.length) throw fail('CDATA outside the root element', i);
      stack[stack.length - 1].children.push(src.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) throw fail('Unclosed processing instruction', i);
      const body = src.slice(i + 2, end);
      if (/^xml\s/.test(body)) {
        if (i !== 0 && src.slice(0, i).trim()) throw fail('The XML declaration must be at the very start', i);
        declaration = body;
      }
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!DOCTYPE', i)) {
      // Skip the DOCTYPE, including an internal subset, without interpreting it.
      let depth = 0;
      let k = i + 9;
      for (; k < n; k++) {
        const c = src[k];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = k + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(src);
      if (!m) throw fail('Malformed closing tag', i);
      const close = src.indexOf('>', NAME.lastIndex);
      if (close < 0 || src.slice(NAME.lastIndex, close).trim()) throw fail('Malformed closing tag', i);
      const open = stack.pop();
      if (!open) throw fail(`Closing tag </${m[0]}> without an opening tag`, i);
      if (open.name !== m[0]) throw fail(`Expected </${open.name}> (opened on line ${open.line}) but found </${m[0]}>`, i);
      nsStack.pop();
      i = close + 1;
      continue;
    }
    // Start tag
    NAME.lastIndex = i + 1;
    const m = NAME.exec(src);
    if (!m) throw fail('Invalid tag name', i + 1);
    const pos = i;
    const name = m[0];
    let k = NAME.lastIndex;
    const attrs = {};
    let selfClose = false;
    for (;;) {
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === '>') { k++; break; }
      if (src[k] === '/' && src[k + 1] === '>') { selfClose = true; k += 2; break; }
      NAME.lastIndex = k;
      const a = NAME.exec(src);
      if (!a) throw fail(`Unexpected character "${src[k] || 'end of file'}" in <${name}>`, k);
      k = NAME.lastIndex;
      while (/\s/.test(src[k])) k++;
      if (src[k] !== '=') throw fail(`Attribute ${a[0]} has no value`, k);
      k++;
      while (/\s/.test(src[k])) k++;
      const q = src[k];
      if (q !== '"' && q !== "'") throw fail(`Attribute ${a[0]} value must be quoted`, k);
      const end = src.indexOf(q, k + 1);
      if (end < 0) throw fail(`Unclosed attribute value for ${a[0]}`, k);
      if (a[0] in attrs) throw fail(`Duplicate attribute ${a[0]}`, k);
      attrs[a[0]] = decodeEntities(src.slice(k + 1, end), k, fail);
      k = end + 1;
    }
    const scope = { ...nsStack[nsStack.length - 1] };
    for (const [an, av] of Object.entries(attrs)) {
      if (an === 'xmlns') scope[''] = av;
      else if (an.startsWith('xmlns:')) scope[an.slice(6)] = av;
    }
    const colon = name.indexOf(':');
    const prefix = colon > 0 ? name.slice(0, colon) : '';
    const { line, col } = locate(pos);
    const node = {
      name, prefix, local: colon > 0 ? name.slice(colon + 1) : name, ns: scope[prefix] ?? null,
      attrs, children: [], line, col, parent: stack[stack.length - 1] || null, nsScope: scope,
    };
    if (prefix && scope[prefix] === undefined) throw fail(`Namespace prefix "${prefix}" is not declared`, pos);
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) throw fail('Only one root element is allowed', pos);
    else root = node;
    if (!selfClose) {
      stack.push(node);
      nsStack.push(scope);
    }
    i = k;
  }
  if (stack.length) {
    const open = stack[stack.length - 1];
    throw new XmlError(`<${open.name}> (line ${open.line}) is never closed`, open.line, open.col);
  }
  if (!root) throw new XmlError('No root element found - is this XML?', 1, 1);
  return { root, declaration };
}

// ---------- queries (by local name, ignoring prefixes) ----------

export const elements = (node) => (node ? node.children.filter((c) => typeof c === 'object') : []);

/** First descendant-or-child by a path of local names: "Party/PartyName/Name". */
export function find(node, path) {
  if (!node) return null;
  let cur = [node];
  for (const part of path.split('/')) {
    const next = [];
    for (const c of cur) for (const e of elements(c)) if (e.local === part) next.push(e);
    if (!next.length) return null;
    cur = next;
  }
  return cur[0];
}

/** All matches of a path (the last step may match several). */
export function findAll(node, path) {
  if (!node) return [];
  let cur = [node];
  for (const part of path.split('/')) {
    const next = [];
    for (const c of cur) for (const e of elements(c)) if (e.local === part) next.push(e);
    cur = next;
  }
  return cur;
}

/** All descendants with a local name, depth-first. */
export function descendants(node, local) {
  const out = [];
  const walk = (x) => {
    for (const e of elements(x)) {
      if (!local || e.local === local) out.push(e);
      walk(e);
    }
  };
  walk(node);
  return out;
}

export function text(node) {
  if (!node) return '';
  let s = '';
  for (const c of node.children) s += typeof c === 'string' ? c : text(c);
  return s.trim();
}

/** Text at a path, or '' */
export const val = (node, path) => text(find(node, path));

export function attr(node, name) {
  if (!node) return '';
  if (name in node.attrs) return node.attrs[name];
  const k = Object.keys(node.attrs).find((a) => a.split(':').pop() === name);
  return k ? node.attrs[k] : '';
}

/** Slash path of local names from the root, with positions for repeats: /Invoice/InvoiceLine[2]/ID */
export function pathOf(node) {
  const parts = [];
  for (let x = node; x; x = x.parent) {
    let label = x.local;
    if (x.parent) {
      const same = elements(x.parent).filter((e) => e.local === x.local);
      if (same.length > 1) label += `[${same.indexOf(x) + 1}]`;
    }
    parts.unshift(label);
  }
  return `/${parts.join('/')}`;
}

// ---------- output ----------

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

/** Pretty-print. Whitespace-only text between elements is replaced by indentation. */
export function serialize(root, { indent = 2, declaration = true, sortAttrs = false } = {}) {
  const pad = typeof indent === 'number' ? ' '.repeat(indent) : indent;
  const lines = [];
  const open = (e) => {
    const names = Object.keys(e.attrs);
    if (sortAttrs) names.sort();
    return `<${e.name}${names.map((a) => ` ${a}="${escAttr(e.attrs[a])}"`).join('')}`;
  };
  const walk = (e, depth) => {
    const ind = pad.repeat(depth);
    const kids = e.children.filter((c) => typeof c !== 'string' || c.trim());
    if (!kids.length) { lines.push(`${ind}${open(e)}/>`); return; }
    const hasElem = kids.some((c) => typeof c === 'object');
    const hasText = kids.some((c) => typeof c === 'string');
    if (!hasElem) { lines.push(`${ind}${open(e)}>${escText(kids.join(''))}</${e.name}>`); return; }
    if (hasText) {
      // Mixed content: keep on one line to preserve meaning.
      const inner = e.children.map((c) => (typeof c === 'string' ? escText(c) : serialize(c, { indent: '', declaration: false, sortAttrs }).replace(/\n/g, ''))).join('');
      lines.push(`${ind}${open(e)}>${inner}</${e.name}>`);
      return;
    }
    lines.push(`${ind}${open(e)}>`);
    for (const c of kids) walk(c, depth + 1);
    lines.push(`${ind}</${e.name}>`);
  };
  walk(root, 0);
  return (declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') + lines.join('\n');
}

/** Minify: drop whitespace-only text between elements. */
export function minify(root) {
  return serialize(root, { indent: '', declaration: true }).replace(/\n/g, '');
}

/**
 * Generic XML → JSON. Attributes become "@name", text "#text" (or the
 * value itself for simple elements), repeated elements become arrays.
 */
export function toJson(node, { prefixes = false, attributes = true } = {}) {
  const key = (e) => (prefixes ? e.name : e.local);
  const conv = (e) => {
    const kids = elements(e);
    const attrs = attributes ? Object.entries(e.attrs).filter(([a]) => a !== 'xmlns' && !a.startsWith('xmlns:')) : [];
    const t = e.children.filter((c) => typeof c === 'string').join('').trim();
    if (!kids.length && !attrs.length) return t;
    const o = {};
    for (const [a, v] of attrs) o[`@${prefixes ? a : a.split(':').pop()}`] = v;
    const repeated = new Set();
    for (const k of kids) {
      const name = key(k);
      const v = conv(k);
      if (!(name in o)) o[name] = v;
      else {
        if (!repeated.has(name)) { o[name] = [o[name]]; repeated.add(name); }
        o[name].push(v);
      }
    }
    if (t) o['#text'] = t;
    return o;
  };
  return { [key(node)]: conv(node) };
}

/** Collect declared namespaces on the root element. */
export function namespaces(root) {
  const out = {};
  for (const [a, v] of Object.entries(root.attrs)) {
    if (a === 'xmlns') out[''] = v;
    else if (a.startsWith('xmlns:')) out[a.slice(6)] = v;
  }
  return out;
}
