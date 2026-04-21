const DEFAULT_SETTINGS = {
  format: 'xml',
  fields: {
    url: true,
    sel: true,
    tag: true,
    comp: true,
    ancestors: true,
    src: true,
    fw: true,
    label: true,
    state: true,
    txt: true,
  }
};

const FIELD_INFO = {
  url:       { label: 'url',       desc: 'Page URL + route' },
  sel:       { label: 'sel',       desc: 'CSS selector (validated)' },
  tag:       { label: 'tag',       desc: 'HTML tag + role' },
  comp:      { label: 'comp',      desc: 'Component name (React/Vue/etc)' },
  ancestors: { label: 'ancestors', desc: 'Parent component chain' },
  src:       { label: 'src',       desc: 'Source file:line (dev builds)' },
  fw:        { label: 'fw',        desc: 'Framework detected' },
  label:     { label: 'label',     desc: 'Associated label or heading' },
  state:     { label: 'state',     desc: 'href, checked, disabled, etc' },
  txt:       { label: 'txt',       desc: 'Element text content' },
};

const SAMPLE_INFO = {
  url: 'https://myapp.com/dashboard',
  route: '/dashboard',
  sel: 'nav>button[data-testid="submit"]',
  tag: 'button',
  role: null,
  comp: 'SubmitButton',
  ancestors: 'CheckoutForm > PaymentStep',
  src: 'src/components/SubmitButton.tsx:42',
  srcFile: 'src/components/SubmitButton.tsx',
  srcLine: 42,
  fw: 'react',
  label: 'near-heading: "Account"',
  state: 'type=button, disabled',
  txt: 'Create account',
};

function formatYaml(info, settings) {
  const lines = [];
  const order = ['url', 'sel', 'tag', 'comp', 'ancestors', 'src', 'fw', 'label', 'state', 'txt'];
  for (const key of order) {
    if (info[key] == null) continue;
    if (settings.fields[key] === false) continue;
    lines.push(`${key}: ${info[key]}`);
  }
  return lines.join('\n');
}

function formatJson(info, settings) {
  const out = {};
  const order = ['url', 'sel', 'tag', 'comp', 'ancestors', 'src', 'fw', 'label', 'state', 'txt'];
  for (const key of order) {
    if (info[key] == null) continue;
    if (settings.fields[key] === false) continue;
    out[key] = info[key];
  }
  return JSON.stringify(out, null, 2);
}

function formatXml(info, settings) {
  return `<CodeReference>\n${formatYaml(info, settings)}\n</CodeReference>`;
}

function formatSentence(info, settings) {
  const f = settings.fields;
  const parts = [];
  if (info.comp && f.comp !== false) parts.push(`the ${info.comp} component`);
  else if (info.tag && f.tag !== false) parts.push(`a <${info.tag}> element`);

  if (info.txt && f.txt !== false) parts.push(`with text "${info.txt}"`);
  else if (info.label && f.label !== false) parts.push(`labeled "${info.label}"`);

  if (info.src && f.src !== false) parts.push(`defined in ${info.src}`);
  if (info.state && f.state !== false) parts.push(`(${info.state})`);

  if (info.url && f.url !== false) parts.push(`on ${info.url}`);
  if (info.sel && f.sel !== false) parts.push(`\n\nSelector: ${info.sel}`);
  return parts.join(' ');
}

function format(info, settings) {
  if (settings.format === 'json') return formatJson(info, settings);
  if (settings.format === 'sentence') return formatSentence(info, settings);
  if (settings.format === 'yaml') return formatYaml(info, settings);
  return formatXml(info, settings);
}

let currentSettings = { ...DEFAULT_SETTINGS };

function renderFields() {
  const container = document.getElementById('fieldsContainer');
  container.innerHTML = '';
  Object.entries(FIELD_INFO).forEach(([key, info]) => {
    const enabled = currentSettings.fields[key] !== false;
    const wrapper = document.createElement('label');
    wrapper.className = 'field-toggle';
    wrapper.innerHTML = `
      <div class="meta">
        <div class="field-name">${info.label}</div>
        <span class="field-desc">${info.desc}</span>
      </div>
      <div style="position:relative;">
        <input type="checkbox" id="field-${key}" ${enabled ? 'checked' : ''}>
        <div class="switch"></div>
      </div>
    `;
    container.appendChild(wrapper);
    const input = wrapper.querySelector('input');
    input.addEventListener('change', () => {
      currentSettings.fields[key] = input.checked;
      save();
      renderPreview();
    });
  });
}

function estimateTokens(s) {
  // Rough heuristic: ~4 chars/token for English+code
  return Math.max(1, Math.round(s.length / 4));
}

function renderPreview() {
  const out = format(SAMPLE_INFO, currentSettings);
  document.getElementById('preview').textContent = out;
  const tc = document.getElementById('tokenCount');
  if (tc) tc.textContent = `~${estimateTokens(out)} tokens · ${out.length} chars`;
}

function setFormatRadio() {
  document.querySelectorAll('input[name="format"]').forEach(r => {
    r.checked = r.value === currentSettings.format;
  });
}

function bindFormatRadios() {
  document.querySelectorAll('input[name="format"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) {
        currentSettings.format = r.value;
        save();
        renderPreview();
      }
    });
  });
}

let saveTimer = null;
function save() {
  chrome.storage.sync.set({ settings: currentSettings });
  showStatus();
}

function showStatus() {
  const el = document.getElementById('status');
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

document.getElementById('resetBtn').addEventListener('click', () => {
  currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  save();
  setFormatRadio();
  renderFields();
  renderPreview();
});

document.getElementById('copyBtn')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const text = document.getElementById('preview').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  } catch {}
});

chrome.storage.sync.get(['settings'], (data) => {
  if (data.settings) {
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...data.settings,
      fields: { ...DEFAULT_SETTINGS.fields, ...(data.settings.fields || {}) }
    };
  }
  setFormatRadio();
  bindFormatRadios();
  renderFields();
  renderPreview();
});