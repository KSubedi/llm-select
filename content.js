(function() {
  // Prevent double-injection
  if (window.__llmInspectorLoaded) return;
  window.__llmInspectorLoaded = true;

  // ============================================================
  // DEFAULT SETTINGS
  // ============================================================
  const DEFAULT_SETTINGS = {
    format: 'xml',           // 'xml' | 'yaml' | 'json' | 'sentence'
    fields: {
      url: true,
      sel: true,
      tag: true,
      comp: true,
      ancestors: true,
      src: true,
      txt: true,
      label: true,
      state: true,
    }
  };

  let settings = { ...DEFAULT_SETTINGS };
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get(['settings'], (data) => {
      if (data.settings) {
        settings = {
          ...DEFAULT_SETTINGS,
          ...data.settings,
          fields: { ...DEFAULT_SETTINGS.fields, ...(data.settings.fields || {}) }
        };
      }
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.settings) {
        const ns = changes.settings.newValue;
        settings = {
          ...DEFAULT_SETTINGS,
          ...ns,
          fields: { ...DEFAULT_SETTINGS.fields, ...(ns?.fields || {}) }
        };
      }
    });
  }

  let currentHighlight = null;
  let currentPreview = null;

  // ============================================================
  // FRAMEWORK DETECTION (React, Vue, Svelte, Angular, Solid)
  // ============================================================
  const __compCache = new WeakMap();

  function findReactKeys(element) {
    if (!element || typeof element !== 'object') return [];
    try {
      return Object.keys(element).filter(k =>
        k.startsWith('__react') ||
        k.startsWith('_react') ||
        k.includes('reactFiber') ||
        k.includes('reactContainer')
      );
    } catch (e) { return []; }
  }

  function getFiberTypeName(type) {
    if (!type || typeof type === 'string') return null;
    if (type.displayName) return type.displayName;
    if (type.name) return type.name;
    if (type.render) {
      return type.render.displayName || type.render.name || null;
    }
    return null;
  }

  function getFiberFromElement(element) {
    // Find the nearest fiber attached to this or an ancestor element
    let el = element;
    let domDepth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && domDepth < 10) {
      const keys = findReactKeys(el);
      for (const key of keys) {
        const val = el[key];
        if (!val) continue;
        if (typeof val === 'object' && val.stateNode !== undefined) return val;
        if (typeof val === 'object' && val.type !== undefined) return val;
        if (val._internalRoot?.current) return val._internalRoot.current;
      }
      el = el.parentElement;
      domDepth++;
    }
    // Try DevTools hook fallback
    try {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook?.renderers) {
        for (const renderer of hook.renderers.values()) {
          const fiber = renderer.findFiberByHostInstance?.(element);
          if (fiber) return fiber;
        }
      }
    } catch (e) {}
    return null;
  }

  // Framework/router plumbing we don't want to surface as the component or in ancestors
  const WRAPPER_NAMES = new Set([
    'HydratedRouter', 'ServerRouter', 'RouterProvider', 'BrowserRouter', 'MemoryRouter', 'HashRouter',
    'Outlet', 'Route', 'Routes', 'Router',
    'Await', 'ResolveAwait',
    'Provider', 'Consumer', 'Context', 'ContextProvider',
    'Suspense', 'SuspenseList', 'ErrorBoundary', 'Fragment', 'StrictMode', 'Profiler',
    'QueryClientProvider', 'HydrationBoundary',
    'ThemeProvider', 'HelmetProvider',
    'Observer', 'AutoObserver',
  ]);
  const WRAPPER_PATTERNS = [
    /^WithComponentProps\d*$/,       // React Router v7
    /^_?withRouter$/i,
    /^_c\d*$/,                        // react-refresh anonymous wrappers
    /^\$\$.*$/,                       // internal sigils
    /^Connect\(.+\)$/,                // react-redux
    /^Observer\(.+\)$/,                // mobx
    /^ForwardRef(\(.+\))?$/,
    /^Memo(\(.+\))?$/,
  ];
  function isWrapperName(n) {
    if (!n) return true;
    if (WRAPPER_NAMES.has(n)) return true;
    return WRAPPER_PATTERNS.some(r => r.test(n));
  }

  function getReactInfo(element) {
    const fiber = getFiberFromElement(element);
    if (!fiber) return null;

    let current = fiber;
    let depth = 0;
    const seen = new Set();
    let name = null;
    let fallbackName = null;   // first named thing, even if it's a wrapper
    let source = null;
    let sourceFile = null;
    let sourceLine = null;
    const chain = [];

    while (current && depth < 40) {
      if (seen.has(current)) break;
      seen.add(current);

      const typeName = getFiberTypeName(current.type) || getFiberTypeName(current.elementType);
      if (typeName) {
        if (!fallbackName) fallbackName = typeName;
        if (!name && !isWrapperName(typeName)) name = typeName;
        if (!isWrapperName(typeName) && chain[chain.length - 1] !== typeName) {
          chain.push(typeName);
        }
      }

      // _debugSource is present in dev builds with @babel/plugin-transform-react-jsx-source
      if (!source && current._debugSource) {
        const ds = current._debugSource;
        const file = ds.fileName;
        if (file) {
          const parts = file.split('/');
          const srcIdx = parts.lastIndexOf('src');
          const appIdx = parts.lastIndexOf('app');
          const cutoff = Math.max(srcIdx, appIdx);
          const shortPath = cutoff >= 0 ? parts.slice(cutoff).join('/') : parts.slice(-2).join('/');
          sourceFile = shortPath;
          sourceLine = ds.lineNumber;
          source = `${shortPath}:${ds.lineNumber}`;
        }
      }

      // Walk up via debugOwner first (more semantically meaningful), then fiber return
      current = current._debugOwner || current.return;
      depth++;
    }

    const finalName = name || fallbackName;
    if (!finalName && !source) return null;

    // Ancestors = named user components above the immediate one, capped at 3
    const ancestors = chain.slice(1, 4);
    return {
      framework: 'react',
      name: finalName,
      source,
      sourceFile,
      sourceLine,
      ancestors: ancestors.length ? ancestors : null,
    };
  }

  function getVueInfo(element) {
    // Vue 2: __vue__, Vue 3: __vueParentComponent
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 10) {
      // Vue 3
      if (el.__vueParentComponent) {
        const comp = el.__vueParentComponent;
        const name = comp.type?.name || comp.type?.__name || comp.type?.__file?.split('/').pop()?.replace(/\.\w+$/, '');
        const file = comp.type?.__file;
        if (name || file) {
          return {
            framework: 'vue',
            name: name || null,
            source: file ? shortenPath(file) : null
          };
        }
      }
      // Vue 2
      if (el.__vue__) {
        const vm = el.__vue__;
        const name = vm.$options?.name || vm.$options?._componentTag;
        const file = vm.$options?.__file;
        if (name || file) {
          return {
            framework: 'vue',
            name: name || null,
            source: file ? shortenPath(file) : null
          };
        }
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function getSvelteInfo(element) {
    // Svelte doesn't expose component names by default, but dev mode adds them
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 10) {
      // Svelte stores component info in various places in dev mode
      const keys = Object.keys(el).filter(k => k.startsWith('__svelte'));
      for (const key of keys) {
        const val = el[key];
        if (val?.ctx || val?.$$) {
          const name = val.constructor?.name;
          if (name && name !== 'Object') {
            return { framework: 'svelte', name, source: null };
          }
        }
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function getAngularInfo(element) {
    // Check for Angular markers
    if (!document.querySelector('[ng-version]')) return null;
    const version = document.querySelector('[ng-version]')?.getAttribute('ng-version');
    // Try to get component name via ng global in dev mode
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 10) {
      try {
        if (window.ng?.getComponent) {
          const comp = window.ng.getComponent(el);
          if (comp) {
            const name = comp.constructor?.name;
            if (name) return { framework: `angular${version ? ' ' + version : ''}`, name, source: null };
          }
        }
      } catch (e) {}
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function getSolidInfo(element) {
    // Solid.js stores dev info in _$owner
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 10) {
      if (el._$owner) {
        const owner = el._$owner;
        const name = owner.componentName || owner.name;
        if (name) return { framework: 'solid', name, source: null };
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function shortenPath(file) {
    if (!file) return null;
    const parts = file.split('/');
    const srcIdx = parts.lastIndexOf('src');
    const appIdx = parts.lastIndexOf('app');
    const cutoff = Math.max(srcIdx, appIdx);
    return cutoff >= 0 ? parts.slice(cutoff).join('/') : parts.slice(-2).join('/');
  }

  function getComponentInfo(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (__compCache.has(element)) return __compCache.get(element);

    const info =
      getReactInfo(element) ||
      getVueInfo(element) ||
      getSvelteInfo(element) ||
      getAngularInfo(element) ||
      getSolidInfo(element);

    __compCache.set(element, info);
    return info;
  }

  // ============================================================
  // SELECTOR GENERATION (with validation)
  // ============================================================
  function isUtilityClass(c) {
    const prefixes = ['bg-', 'text-', 'p-', 'm-', 'px-', 'py-', 'mx-', 'my-', 'w-', 'h-', 'flex', 'grid', 'block', 'inline', 'hidden', 'visible', 'rounded', 'border', 'shadow', 'hover:', 'focus:', 'active:', 'sm:', 'md:', 'lg:', 'xl:'];
    return prefixes.some(p => c.startsWith(p));
  }

  function selectorMatchesUniquely(selector, element) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch (e) {
      return false;
    }
  }

  function selectorMatchesElement(selector, element) {
    try {
      const matches = document.querySelectorAll(selector);
      return Array.from(matches).includes(element);
    } catch (e) {
      return false;
    }
  }

  function getStableAttrSelector(element) {
    const tag = element.nodeName.toLowerCase();
    const attrs = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'aria-label', 'name'];
    for (const attr of attrs) {
      const val = element.getAttribute(attr);
      if (val) {
        const sel = `${tag}[${attr}="${CSS.escape(val)}"]`;
        if (selectorMatchesUniquely(sel, element)) return sel;
      }
    }
    return null;
  }

  function getStableClasses(element) {
    if (!element.className || typeof element.className !== 'string') return [];
    return element.className.trim().split(/\s+/).filter(c => c && !isUtilityClass(c));
  }

  // Build a selector and validate it matches only the target element
  function generateValidatedSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

    // 1. Stable attrs (testid, aria-label, name)
    const attrSel = getStableAttrSelector(element);
    if (attrSel) return attrSel;

    // 2. ID (if unique)
    if (element.id) {
      const sel = `#${CSS.escape(element.id)}`;
      if (selectorMatchesUniquely(sel, element)) return sel;
    }

    // 3. Build bottom-up, validate at each step
    const parts = [];
    let current = element;
    let maxDepth = 6;

    while (current && current.nodeType === Node.ELEMENT_NODE && maxDepth > 0) {
      const tag = current.nodeName.toLowerCase();
      let part = tag;

      // Add ID if present
      if (current.id) {
        part = `#${CSS.escape(current.id)}`;
      } else {
        // Try stable attrs
        const attr = current.getAttribute('data-testid') || current.getAttribute('data-test');
        if (attr) {
          part = `${tag}[data-testid="${CSS.escape(attr)}"]`;
        } else {
          const classes = getStableClasses(current);
          if (classes.length > 0) {
            part = `${tag}.${classes.slice(0, 2).map(c => CSS.escape(c)).join('.')}`;
          }

          // Add nth-of-type if still ambiguous among siblings
          if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children);
            const sameTagSiblings = siblings.filter(s => s.nodeName === current.nodeName);
            if (sameTagSiblings.length > 1) {
              // Check if current `part` is unique among siblings
              const matchingSiblings = siblings.filter(s => {
                try { return s.matches(part); } catch (e) { return false; }
              });
              if (matchingSiblings.length > 1) {
                const idx = sameTagSiblings.indexOf(current) + 1;
                part = `${part}:nth-of-type(${idx})`;
              }
            }
          }
        }
      }

      parts.unshift(part);

      // Check if the selector is now unique
      const candidate = parts.join('>');
      if (selectorMatchesUniquely(candidate, element)) {
        return candidate;
      }

      // Stop if we hit an ID (nothing above will help)
      if (part.startsWith('#')) break;

      current = current.parentElement;
      maxDepth--;
    }

    const final = parts.join('>');
    return selectorMatchesElement(final, element) ? final : '';
  }

  // ============================================================
  // LABELS, CONTEXT, STATE
  // ============================================================
  function getText(element) {
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 120 ? text.slice(0, 120) + '...' : text;
  }

  // For inputs, find associated label. For others, nearby heading or aria-label.
  function getSemanticLabel(element) {
    // aria-label wins
    const aria = element.getAttribute('aria-label');
    if (aria) return aria;

    // aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.innerText) return labelEl.innerText.trim();
    }

    // <label for="id">
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.innerText) return label.innerText.trim();
    }

    // Wrapping label: <label>...<input></label>
    const parentLabel = element.closest('label');
    if (parentLabel && parentLabel !== element) {
      const txt = parentLabel.innerText.replace(element.innerText || '', '').trim();
      if (txt) return txt;
    }

    // For form inputs, look for placeholder or preceding label
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName)) {
      const placeholder = element.getAttribute('placeholder');
      if (placeholder) return `placeholder="${placeholder}"`;
    }

    // Nearest preceding heading (gives section context)
    let el = element.previousElementSibling;
    let scanned = 0;
    while (el && scanned < 5) {
      if (/^H[1-6]$/.test(el.nodeName)) return `near-heading: "${el.innerText.trim().slice(0, 60)}"`;
      el = el.previousElementSibling;
      scanned++;
    }
    // Check parent's previous siblings for a heading
    if (element.parentElement) {
      el = element.parentElement.previousElementSibling;
      scanned = 0;
      while (el && scanned < 3) {
        if (/^H[1-6]$/.test(el.nodeName)) return `under-heading: "${el.innerText.trim().slice(0, 60)}"`;
        el = el.previousElementSibling;
        scanned++;
      }
    }

    return null;
  }

  function getElementState(element) {
    const state = [];
    const tag = element.nodeName.toLowerCase();

    if (tag === 'a' && element.href) state.push(`href=${element.getAttribute('href')}`);
    if (tag === 'img' && element.alt) state.push(`alt="${element.alt}"`);
    if (tag === 'input') {
      const type = element.type || 'text';
      state.push(`type=${type}`);
      if (element.disabled) state.push('disabled');
      if (element.required) state.push('required');
      if (type === 'checkbox' || type === 'radio') {
        state.push(element.checked ? 'checked' : 'unchecked');
      }
      if (element.value) state.push(`value="${element.value.slice(0, 40)}"`);
    }
    if (tag === 'button' && element.disabled) state.push('disabled');
    if (tag === 'select') {
      state.push(`options=${element.options?.length || 0}`);
    }

    const expanded = element.getAttribute('aria-expanded');
    if (expanded) state.push(`expanded=${expanded}`);
    const checked = element.getAttribute('aria-checked');
    if (checked) state.push(`checked=${checked}`);
    const selected = element.getAttribute('aria-selected');
    if (selected) state.push(`selected=${selected}`);

    return state.length ? state.join(', ') : null;
  }

  // ============================================================
  // INSPECTION & FORMATTING
  // ============================================================
  function inspectElement(element) {
    const info = {
      url: window.location.href,
      route: window.location.pathname + (window.location.hash || ''),
      sel: generateValidatedSelector(element),
      tag: element.nodeName.toLowerCase(),
    };

    const role = element.getAttribute('role');
    if (role) info.role = role;

    const compInfo = getComponentInfo(element);
    if (compInfo) {
      if (compInfo.name) info.comp = compInfo.name;
      if (compInfo.source) info.src = compInfo.source;
      if (compInfo.sourceFile) info.srcFile = compInfo.sourceFile;
      if (compInfo.sourceLine) info.srcLine = compInfo.sourceLine;
      if (compInfo.ancestors) info.ancestors = compInfo.ancestors.join(' > ');
      if (compInfo.framework) info.fw = compInfo.framework;
    }

    const label = getSemanticLabel(element);
    if (label) info.label = label;

    const state = getElementState(element);
    if (state) info.state = state;

    const text = getText(element);
    if (text) info.txt = text;

    return info;
  }

  function formatXml(info) {
    return `<CodeReference>\n${formatYaml(info)}\n</CodeReference>`;
  }

  function formatYaml(info) {
    const lines = [];
    const order = ['url', 'sel', 'tag', 'comp', 'ancestors', 'src', 'fw', 'label', 'state', 'txt'];
    for (const key of order) {
      if (info[key] == null) continue;
      if (settings.fields && settings.fields[key] === false) continue;
      const val = typeof info[key] === 'string' && (info[key].includes('\n') || info[key].includes('"'))
        ? JSON.stringify(info[key])
        : info[key];
      lines.push(`${key}: ${val}`);
    }
    return lines.join('\n');
  }

  function formatJson(info) {
    const out = {};
    const order = ['url', 'sel', 'tag', 'comp', 'ancestors', 'src', 'fw', 'label', 'state', 'txt'];
    for (const key of order) {
      if (info[key] == null) continue;
      if (settings.fields && settings.fields[key] === false) continue;
      out[key] = info[key];
    }
    return JSON.stringify(out, null, 2);
  }

  function formatSentence(info) {
    const parts = [];
    if (info.comp) parts.push(`the ${info.comp} component`);
    else if (info.tag) parts.push(`a <${info.tag}> element`);

    if (info.txt) parts.push(`with text "${info.txt}"`);
    else if (info.label) parts.push(`labeled "${info.label}"`);

    if (info.src) parts.push(`defined in ${info.src}`);
    if (info.state) parts.push(`(${info.state})`);

    parts.push(`on ${info.url}`);
    parts.push(`\n\nSelector: ${info.sel}`);
    return parts.join(' ');
  }

  function formatForLLM(info) {
    if (settings.format === 'json') return formatJson(info);
    if (settings.format === 'sentence') return formatSentence(info);
    if (settings.format === 'yaml') return formatYaml(info);
    return formatXml(info);
  }

  // ============================================================
  // UI
  // ============================================================
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showCopiedToast());
  }

  function showCopiedToast() {
    const toast = document.createElement('div');
    toast.textContent = 'Copied to clipboard';
    toast.style.cssText = `
      position:fixed;z-index:2147483647;bottom:20px;right:20px;
      background:#1e1e2e;color:#fff;padding:10px 16px;border-radius:6px;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;
      opacity:0;transform:translateY(10px);transition:all 0.2s;
    `;
    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 200);
    }, 1500);
  }

  function showHighlight(element) {
    removeHighlight();
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const highlight = document.createElement('div');
    highlight.className = 'llm-inspector-highlight';
    highlight.style.cssText = `
      position:absolute;pointer-events:none;z-index:2147483647;
      border:2px solid #3b82f6;background:rgba(59,130,246,0.1);
      top:${rect.top + scrollY}px;left:${rect.left + scrollX}px;
      width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;
    `;
    document.documentElement.appendChild(highlight);
    currentHighlight = highlight;

    const preview = document.createElement('div');
    preview.className = 'llm-inspector-preview';
    const tag = element.nodeName.toLowerCase();
    const idStr = element.id ? `#${element.id}` : '';
    const cls = element.className && typeof element.className === 'string'
      ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const compInfo = getComponentInfo(element);
    const compStr = compInfo?.name ? ` <${compInfo.name}>` : '';
    preview.innerHTML = `<span style="background:#1e40af;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;font-family:monospace;">&lt;${tag}${idStr}${cls}&gt;${compStr}</span>`;
    preview.style.cssText = `
      position:absolute;pointer-events:none;z-index:2147483647;
      top:${rect.top + scrollY - 24}px;left:${rect.left + scrollX}px;
    `;
    document.documentElement.appendChild(preview);
    currentPreview = preview;
  }

  function removeHighlight() {
    currentHighlight?.remove();
    currentPreview?.remove();
    currentHighlight = null;
    currentPreview = null;
  }

  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  document.addEventListener('mouseover', function(e) {
    if (!window.__llmInspectorActive) return;
    if (e.target.closest('.llm-inspector-highlight, .llm-inspector-preview')) return;
    showHighlight(e.target);
  });

  document.addEventListener('mouseout', function(e) {
    if (!window.__llmInspectorActive) return;
    if (e.target.closest('.llm-inspector-highlight')) return;
    removeHighlight();
  });

  document.addEventListener('click', function(e) {
    if (!window.__llmInspectorActive) return;
    e.preventDefault();
    e.stopPropagation();
    const info = inspectElement(e.target);
    copyToClipboard(formatForLLM(info));
    removeHighlight();
    window.__llmInspectorActive = false;
    document.body.style.cursor = '';
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && window.__llmInspectorActive) {
      window.__llmInspectorActive = false;
      removeHighlight();
      document.body.style.cursor = '';
    }
  });

  // Expose toggle function for background script
  window.__llmInspectorToggle = function() {
    window.__llmInspectorActive = !window.__llmInspectorActive;
    if (window.__llmInspectorActive) {
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = '';
      removeHighlight();
    }
  };
})();