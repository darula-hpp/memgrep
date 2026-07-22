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
          <p class="lede">Changes re-fill from the original template and overwrite the doc in <code>.memgrep/docs</code>.</p>
        </header>
        <section class="panel">
          <label class="field">
            <span>Document</span>
            <select id="docSelect"></select>
          </label>
          <p id="meta" class="status"></p>
          <form id="fieldsForm" class="fields"></form>
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
  width: min(720px, calc(100% - 2rem));
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

.lede { margin: 0.75rem 0 0; color: var(--muted); max-width: 46ch; }
.panel {
  margin-top: 1.75rem;
  padding: 1.35rem;
  background: var(--panel);
  border: 1px solid var(--line);
}
.fields { display: grid; gap: 0.9rem; margin-top: 1rem; }
.field { display: grid; gap: 0.35rem; }
.field span { font-size: 0.92rem; font-weight: 600; }
.field textarea, .field select {
  width: 100%;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--line);
  background: #fff;
}
.actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
button {
  border: 0;
  padding: 0.75rem 1.1rem;
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
}
button.ghost {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--line);
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

function showError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || '';
}

function flatContext(context) {
  const out = {};
  function walk(obj, prefix) {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
      else out[key] = v == null ? '' : String(v);
    }
  }
  walk(context, '');
  return out;
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
  const values = flatContext(data.meta.context || {});
  const fields = data.fields?.length ? data.fields : Object.keys(values);
  form.innerHTML = '';
  for (const field of fields) {
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = field;
    const ta = document.createElement('textarea');
    ta.name = field;
    ta.rows = field.toLowerCase().includes('summary') || field.toLowerCase().includes('notes') ? 4 : 2;
    ta.value = values[field] ?? '';
    label.appendChild(span);
    label.appendChild(ta);
    form.appendChild(label);
  }
  statusEl.textContent = fields.length + ' field' + (fields.length === 1 ? '' : 's');
}

async function saveDoc() {
  showError('');
  statusEl.textContent = 'Saving…';
  saveBtn.disabled = true;
  try {
    const context = {};
    for (const el of form.querySelectorAll('textarea')) {
      context[el.name] = el.value;
    }
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
