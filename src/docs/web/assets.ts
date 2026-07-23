/** Embedded static editor UI (no Vite runtime). */

export const EDITOR_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>memgrep docs editor</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="page">
      <main class="shell">
        <header class="brand">
          <p class="brand-mark">memgrep docs</p>
          <h1>Edit filled Word fields</h1>
          <p class="lede">Changes re-fill from the original template and overwrite the doc in <code>.memgrep/docs</code>. Iterable rows and nested block loops (cases → steps) support add/remove.</p>
        </header>
        <section class="panel">
          <label class="field">
            <span>Document</span>
            <select id="docSelect"></select>
          </label>
          <p id="meta" class="status"></p>
          <div id="fieldsForm" class="fields"></div>
          <p id="error" class="error" hidden></p>
          <p id="status" class="status"></p>
          <div class="actions">
            <button type="button" id="reloadBtn" class="ghost">Reload</button>
            <button type="button" id="saveBtn">Save</button>
          </div>
        </section>
      </main>
    </div>
    <script src="/app.js"></script>
  </body>
</html>
`;

export const EDITOR_CSS = `:root {
  --ink: #1c241c;
  --muted: #4d5a4d;
  --paper: #f3f6f1;
  --panel: rgba(255, 255, 255, 0.9);
  --line: rgba(28, 36, 28, 0.14);
  --accent: #1f6b4a;
  --accent-ink: #f4fff8;
  --danger: #8a2f2f;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.5;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
button, input, textarea, select { font: inherit; }

.page {
  min-height: 100vh;
  background:
    radial-gradient(circle at 12% 18%, rgba(31, 107, 74, 0.14), transparent 34%),
    linear-gradient(160deg, #eef3eb 0%, #f7f4ec 48%, #e7efe8 100%);
}

.shell {
  width: min(880px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 3.5rem 0 4rem;
}

.brand-mark {
  margin: 0 0 0.75rem;
  font-family: "IBM Plex Serif", Georgia, serif;
  font-size: clamp(2rem, 5vw, 2.8rem);
  font-weight: 600;
  letter-spacing: -0.03em;
}

.brand h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
}

.lede { margin: 0.75rem 0 0; color: var(--muted); max-width: 52ch; }
.panel {
  margin-top: 1.75rem;
  padding: 1.35rem;
  background: var(--panel);
  border: 1px solid var(--line);
}
.fields { display: grid; gap: 1.25rem; margin-top: 1rem; }
.field { display: grid; gap: 0.35rem; }
.field > span, .section-title { font-size: 0.92rem; font-weight: 600; }
.field textarea, .field select, .field input {
  width: 100%;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--line);
  background: #fff;
}
.iterable {
  border: 1px solid var(--line);
  padding: 0.9rem;
  background: rgba(255,255,255,0.65);
}
.iterable .iterable {
  margin-top: 0.75rem;
  background: rgba(243, 246, 241, 0.9);
}
.iterable-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.iterable-head p { margin: 0; color: var(--muted); font-size: 0.85rem; }
.rows { display: grid; gap: 0.75rem; }
.row {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px dashed rgba(31, 107, 74, 0.35);
  background: #fff;
}
.row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: var(--muted);
}
.row-grid {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}
.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
button {
  border: 0;
  padding: 0.65rem 1rem;
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
}
button.ghost {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--line);
}
button.danger {
  background: transparent;
  color: var(--danger);
  border: 1px solid rgba(138, 47, 47, 0.35);
}
button:disabled { opacity: 0.55; cursor: not-allowed; }
.status { color: var(--muted); margin: 0.75rem 0 0; }
.error {
  margin: 0.75rem 0 0;
  padding: 0.75rem 0.9rem;
  color: var(--danger);
  background: rgba(138, 47, 47, 0.08);
  border: 1px solid rgba(138, 47, 47, 0.18);
}
.rich {
  border: 1px solid var(--line);
  padding: 0.9rem;
  background: rgba(255,255,255,0.65);
}
.rich-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.5rem 0 0.65rem;
}
.rich-toolbar button {
  padding: 0.4rem 0.65rem;
  font-size: 0.85rem;
  background: #fff;
  color: var(--ink);
  border: 1px solid var(--line);
}
.rich textarea {
  min-height: 12rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
}
.hint { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.82rem; }
`;

export const EDITOR_JS = `const select = document.getElementById('docSelect');
const form = document.getElementById('fieldsForm');
const metaEl = document.getElementById('meta');
const errorEl = document.getElementById('error');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('saveBtn');
const reloadBtn = document.getElementById('reloadBtn');

const params = new URLSearchParams(location.search);
let currentName = params.get('name') || '';
let state = { scalars: {}, rich: {}, richFields: [], iterables: [], scalarFields: [] };

function showError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || '';
}

function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function flattenScalars(context, fields) {
  const out = {};
  for (const field of fields) {
    const v = getByPath(context, field);
    out[field] = v == null ? '' : String(v);
  }
  return out;
}

function emptyItem(schema) {
  const fields = schema.fields?.length ? schema.fields : ['_value'];
  const row = { __fields: fields, __richFields: schema.richFields || [], __nested: schema.iterables || [] };
  for (const f of fields) row[f === '_value' ? '_value' : f] = '';
  for (const f of schema.richFields || []) row[f] = '';
  row.__children = {};
  for (const nested of schema.iterables || []) {
    row.__children[nested.name] = [emptyItem(nested)];
  }
  return row;
}

function normalizeItems(raw, schema) {
  const fields = schema.fields?.length ? schema.fields : ['_value'];
  if (!Array.isArray(raw) || !raw.length) return [emptyItem(schema)];
  return raw.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const row = {
        __fields: fields,
        __richFields: schema.richFields || [],
        __nested: schema.iterables || [],
        __children: {},
      };
      for (const f of fields) {
        if (f === '_value') row._value = item._value != null ? String(item._value) : '';
        else row[f] = item[f] != null ? String(item[f]) : '';
      }
      for (const f of schema.richFields || []) {
        row[f] = item[f] != null ? String(item[f]) : '';
      }
      for (const nested of schema.iterables || []) {
        row.__children[nested.name] = normalizeItems(item[nested.name], nested);
      }
      return row;
    }
    return { ...emptyItem(schema), _value: item == null ? '' : String(item) };
  });
}

function serializeItems(items, schema) {
  const fields = schema.fields?.length ? schema.fields : ['_value'];
  return items.map((row) => {
    if (fields.length === 1 && fields[0] === '_value' && !(schema.iterables || []).length && !(schema.richFields || []).length) {
      return row._value ?? '';
    }
    const obj = {};
    for (const f of fields) {
      if (f === '_value') continue;
      obj[f] = row[f] ?? '';
    }
    for (const f of schema.richFields || []) {
      obj[f] = row[f] ?? '';
    }
    for (const nested of schema.iterables || []) {
      const childRows = (row.__children && row.__children[nested.name]) || [];
      obj[nested.name] = serializeItems(childRows, nested);
    }
    return obj;
  });
}

function countNestedRows(iterables) {
  let cases = 0;
  let steps = 0;
  let flatRows = 0;
  let hasNested = false;
  for (const it of iterables) {
    if (it.kind === 'block' || (it.iterables && it.iterables.length)) {
      hasNested = true;
      cases += it.rows.length;
      for (const row of it.rows) {
        for (const nestedSchema of it.iterables || []) {
          const kids = (row.__children && row.__children[nestedSchema.name]) || [];
          steps += kids.length;
        }
      }
    } else {
      flatRows += it.rows.length;
    }
  }
  return { cases, steps, flatRows, hasNested };
}

function wrapSelection(ta, before, after) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const selected = value.slice(start, end) || 'text';
  ta.value = value.slice(0, start) + before + selected + after + value.slice(end);
  ta.focus();
  ta.selectionStart = start + before.length;
  ta.selectionEnd = start + before.length + selected.length;
  ta.dispatchEvent(new Event('input'));
}

function prefixLines(ta, prefix) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  const lineStart = value.lastIndexOf('\\n', start - 1) + 1;
  const segment = value.slice(lineStart, end);
  const next = segment.split('\\n').map((line) => prefix + line).join('\\n');
  ta.value = value.slice(0, lineStart) + next + value.slice(end);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function renderRichField(field) {
  const box = document.createElement('div');
  box.className = 'rich';
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = field + ' | rich';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Markdown: **bold** *italic* # headings, lists, > indent';
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-toolbar';
  const ta = document.createElement('textarea');
  ta.value = state.rich[field] ?? '';
  ta.addEventListener('input', () => { state.rich[field] = ta.value; });

  const tools = [
    ['Bold', () => wrapSelection(ta, '**', '**')],
    ['Italic', () => wrapSelection(ta, '*', '*')],
    ['H2', () => prefixLines(ta, '## ')],
    ['H3', () => prefixLines(ta, '### ')],
    ['Bullet', () => prefixLines(ta, '- ')],
    ['Number', () => prefixLines(ta, '1. ')],
    ['Indent >', () => prefixLines(ta, '> ')],
  ];
  for (const [label, fn] of tools) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', fn);
    toolbar.appendChild(btn);
  }
  box.appendChild(title);
  box.appendChild(hint);
  box.appendChild(toolbar);
  box.appendChild(ta);
  return box;
}

function render() {
  form.innerHTML = '';

  if (state.scalarFields.length) {
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'Fields';
    section.appendChild(title);
    for (const field of state.scalarFields) {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = field;
      const ta = document.createElement('textarea');
      ta.dataset.kind = 'scalar';
      ta.dataset.field = field;
      ta.rows = /summary|notes|description/i.test(field) ? 4 : 2;
      ta.value = state.scalars[field] ?? '';
      ta.addEventListener('input', () => { state.scalars[field] = ta.value; });
      label.appendChild(span);
      label.appendChild(ta);
      section.appendChild(label);
    }
    form.appendChild(section);
  }

  for (const field of state.richFields) {
    form.appendChild(renderRichField(field));
  }

  function renderIterable(it, mount) {
    const box = document.createElement('div');
    box.className = 'iterable';
    box.dataset.name = it.name;

    const head = document.createElement('div');
    head.className = 'iterable-head';
    const left = document.createElement('div');
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = it.name;
    const p = document.createElement('p');
    const kindLabel = it.kind === 'block' ? 'block' : 'rows';
    const cols = (it.fields || []).join(', ') || '_value';
    p.textContent = kindLabel + ' · for ' + it.itemVar + ' in ' + it.name + ' · ' + cols;
    left.appendChild(h);
    left.appendChild(p);
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = it.kind === 'block' ? 'Add case' : 'Add row';
    addBtn.addEventListener('click', () => {
      it.rows.push(emptyItem(it));
      render();
    });
    head.appendChild(left);
    head.appendChild(addBtn);
    box.appendChild(head);

    const rowsEl = document.createElement('div');
    rowsEl.className = 'rows';
    it.rows.forEach((row, idx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';
      const rowHead = document.createElement('div');
      rowHead.className = 'row-head';
      const label = it.kind === 'block' ? 'Case ' : 'Row ';
      rowHead.innerHTML = '<span>' + label + (idx + 1) + '</span>';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'danger';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        it.rows.splice(idx, 1);
        if (!it.rows.length) it.rows.push(emptyItem(it));
        render();
      });
      rowHead.appendChild(rm);
      rowEl.appendChild(rowHead);

      const grid = document.createElement('div');
      grid.className = 'row-grid';
      for (const field of it.fields || []) {
        const fieldLabel = document.createElement('label');
        fieldLabel.className = 'field';
        const span = document.createElement('span');
        span.textContent = field === '_value' ? it.itemVar : field;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = row[field] ?? '';
        input.addEventListener('input', () => { row[field] = input.value; });
        fieldLabel.appendChild(span);
        fieldLabel.appendChild(input);
        grid.appendChild(fieldLabel);
      }
      rowEl.appendChild(grid);

      for (const field of it.richFields || []) {
        const fieldLabel = document.createElement('label');
        fieldLabel.className = 'field';
        const span = document.createElement('span');
        span.textContent = field + ' | rich';
        const ta = document.createElement('textarea');
        ta.rows = 4;
        ta.value = row[field] ?? '';
        ta.addEventListener('input', () => { row[field] = ta.value; });
        fieldLabel.appendChild(span);
        fieldLabel.appendChild(ta);
        rowEl.appendChild(fieldLabel);
      }

      for (const nested of it.iterables || []) {
        if (!row.__children) row.__children = {};
        if (!row.__children[nested.name]) {
          row.__children[nested.name] = [emptyItem(nested)];
        }
        const nestedState = {
          name: nested.name,
          itemVar: nested.itemVar || 'item',
          kind: nested.kind || 'rows',
          fields: nested.fields?.length ? nested.fields : ['_value'],
          richFields: nested.richFields || [],
          iterables: nested.iterables || [],
          rows: row.__children[nested.name],
        };
        // Keep rows array identity in sync when nested mutates via emptyItem pushes
        nestedState.rows = row.__children[nested.name];
        renderIterable(nestedState, rowEl);
      }

      rowsEl.appendChild(rowEl);
    });
    box.appendChild(rowsEl);
    mount.appendChild(box);
  }

  for (const it of state.iterables) {
    renderIterable(it, form);
  }

  const scalarCount = state.scalarFields.length;
  const richCount = state.richFields.length;
  const counts = countNestedRows(state.iterables);
  if (counts.hasNested) {
    let status = scalarCount + ' field(s), ' + richCount + ' rich, ' + counts.cases + ' case(s), ' + counts.steps + ' step(s)';
    if (counts.flatRows) status += ', ' + counts.flatRows + ' row(s)';
    statusEl.textContent = status;
  } else {
    statusEl.textContent = scalarCount + ' field(s), ' + richCount + ' rich, ' + state.iterables.length + ' iterable(s), ' + counts.flatRows + ' row(s)';
  }
}

function buildContext() {
  const context = {};
  for (const [k, v] of Object.entries(state.scalars)) setByPath(context, k, v);
  for (const [k, v] of Object.entries(state.rich)) setByPath(context, k, v);
  for (const it of state.iterables) {
    setByPath(context, it.name, serializeItems(it.rows, it));
  }
  return context;
}

async function loadList() {
  const res = await fetch('/api/docs');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to list docs');
  select.innerHTML = '';
  for (const doc of data.docs || []) {
    const opt = document.createElement('option');
    opt.value = doc.name;
    opt.textContent = doc.name + ' ← ' + doc.template;
    select.appendChild(opt);
  }
  if (!currentName && data.docs?.length) currentName = data.docs[0].name;
  if (currentName) select.value = currentName;
}

async function loadDoc(name) {
  showError('');
  statusEl.textContent = 'Loading…';
  const res = await fetch('/api/doc/' + encodeURIComponent(name));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load doc');
  currentName = data.name;
  metaEl.textContent = 'Template: ' + data.meta.template + ' · updated ' + (data.meta.updatedAt || '');

  const fields = data.fields || [];
  const richFields = data.richFields || data.meta.richFields || [];
  const iterables = data.iterables || data.meta.iterables || [];
  const ctx = data.meta.context || {};

  state = {
    scalarFields: fields,
    scalars: flattenScalars(ctx, fields),
    richFields,
    rich: flattenScalars(ctx, richFields),
    iterables: iterables.map((it) => {
      const schema = {
        name: it.name,
        itemVar: it.itemVar || 'item',
        kind: it.kind || 'rows',
        fields: it.fields?.length ? it.fields : ['_value'],
        richFields: it.richFields || [],
        iterables: it.iterables || [],
      };
      return {
        ...schema,
        rows: normalizeItems(getByPath(ctx, it.name), schema),
      };
    }),
  };
  render();
}

async function saveDoc() {
  showError('');
  statusEl.textContent = 'Saving…';
  saveBtn.disabled = true;
  try {
    const context = buildContext();
    const res = await fetch('/api/doc/' + encodeURIComponent(currentName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    statusEl.textContent = 'Saved ' + data.docxPath;
    await loadDoc(currentName);
  } catch (err) {
    showError(err.message || String(err));
    statusEl.textContent = '';
  } finally {
    saveBtn.disabled = false;
  }
}

select.addEventListener('change', () => {
  currentName = select.value;
  loadDoc(currentName).catch((e) => showError(e.message));
});
reloadBtn.addEventListener('click', () => loadDoc(currentName).catch((e) => showError(e.message)));
saveBtn.addEventListener('click', () => saveDoc());

(async () => {
  try {
    await loadList();
    if (currentName) await loadDoc(currentName);
    else statusEl.textContent = 'No filled docs yet. Run docs_fill first.';
  } catch (err) {
    showError(err.message || String(err));
  }
})();
`;
