// Runs in the page's MAIN world so it can read React/Vue/Svelte/etc.
// expando properties on DOM nodes (which are invisible from a content
// script's isolated world). Communicates with the isolated-world script
// via a custom DOM event: listener extracts component info, stashes
// JSON on the target element's dataset, isolated world reads it back.
(function() {
  if (window.__llmInspectorMainLoaded) return;
  window.__llmInspectorMainLoaded = true;
  window.__llmInspectorMainVersion = '1.2.1-debug';

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
    let el = element;
    let domDepth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && domDepth < 25) {
      const keys = findReactKeys(el);
      const fiberKey = keys.find(k => k.startsWith('__reactFiber') || k.includes('reactFiber'));
      if (fiberKey) {
        const val = el[fiberKey];
        if (val && typeof val === 'object') return val;
      }
      for (const key of keys) {
        const val = el[key];
        if (!val || typeof val !== 'object') continue;
        if (val._internalRoot?.current) return val._internalRoot.current;
        if (val.stateNode !== undefined || val.type !== undefined ||
            val.return !== undefined || val.memoizedProps !== undefined) {
          return val;
        }
      }
      el = el.parentElement;
      domDepth++;
    }
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
    /^WithComponentProps\d*$/,
    /^_?withRouter$/i,
    /^_c\d*$/,
    /^\$\$.*$/,
    /^Connect\(.+\)$/,
    /^Observer\(.+\)$/,
    /^ForwardRef(\(.+\))?$/,
    /^Memo(\(.+\))?$/,
  ];
  function isWrapperName(n) {
    if (!n) return true;
    if (WRAPPER_NAMES.has(n)) return true;
    return WRAPPER_PATTERNS.some(r => r.test(n));
  }

  function shortenPath(file) {
    if (!file) return null;
    const parts = file.split('/');
    const srcIdx = parts.lastIndexOf('src');
    const appIdx = parts.lastIndexOf('app');
    const cutoff = Math.max(srcIdx, appIdx);
    return cutoff >= 0 ? parts.slice(cutoff).join('/') : parts.slice(-2).join('/');
  }

  function getReactInfo(element) {
    const fiber = getFiberFromElement(element);
    if (!fiber) return null;

    let current = fiber;
    let depth = 0;
    const seen = new Set();
    let name = null;
    let fallbackName = null;
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

      if (!source && current._debugSource) {
        const ds = current._debugSource;
        const file = ds.fileName;
        if (file) {
          const shortPath = shortenPath(file);
          sourceFile = shortPath;
          sourceLine = ds.lineNumber;
          source = `${shortPath}:${ds.lineNumber}`;
        }
      }

      current = current._debugOwner || current.return;
      depth++;
    }

    const finalName = name || fallbackName;
    if (!finalName && !source) return null;

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
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 25) {
      if (el.__vueParentComponent) {
        const comp = el.__vueParentComponent;
        const name = comp.type?.name || comp.type?.__name || comp.type?.__file?.split('/').pop()?.replace(/\.\w+$/, '');
        const file = comp.type?.__file;
        if (name || file) {
          return {
            framework: 'vue',
            name: name || null,
            source: file ? shortenPath(file) : null,
            sourceFile: file ? shortenPath(file) : null,
            sourceLine: null,
            ancestors: null,
          };
        }
      }
      if (el.__vue__) {
        const vm = el.__vue__;
        const name = vm.$options?.name || vm.$options?._componentTag;
        const file = vm.$options?.__file;
        if (name || file) {
          return {
            framework: 'vue',
            name: name || null,
            source: file ? shortenPath(file) : null,
            sourceFile: file ? shortenPath(file) : null,
            sourceLine: null,
            ancestors: null,
          };
        }
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function getSvelteInfo(element) {
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 25) {
      const keys = Object.keys(el).filter(k => k.startsWith('__svelte'));
      for (const key of keys) {
        const val = el[key];
        if (val?.ctx || val?.$$) {
          const name = val.constructor?.name;
          if (name && name !== 'Object') {
            return { framework: 'svelte', name, source: null, sourceFile: null, sourceLine: null, ancestors: null };
          }
        }
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function getAngularInfo(element) {
    if (!document.querySelector('[ng-version]')) return null;
    const version = document.querySelector('[ng-version]')?.getAttribute('ng-version');
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 25) {
      try {
        if (window.ng?.getComponent) {
          const comp = window.ng.getComponent(el);
          if (comp) {
            const name = comp.constructor?.name;
            if (name) return { framework: `angular${version ? ' ' + version : ''}`, name, source: null, sourceFile: null, sourceLine: null, ancestors: null };
          }
        }
      } catch (e) {}
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function getSolidInfo(element) {
    let el = element;
    let depth = 0;
    while (el && el.nodeType === Node.ELEMENT_NODE && depth < 25) {
      if (el._$owner) {
        const owner = el._$owner;
        const name = owner.componentName || owner.name;
        if (name) return { framework: 'solid', name, source: null, sourceFile: null, sourceLine: null, ancestors: null };
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function extract(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    return (
      getReactInfo(element) ||
      getVueInfo(element) ||
      getSvelteInfo(element) ||
      getAngularInfo(element) ||
      getSolidInfo(element)
    );
  }

  // Marker visible to the isolated world (dataset attributes are shared via the DOM).
  try { document.documentElement.dataset.llmInspectorMainReady = '1'; } catch (e) {}

  const ATTR = 'data-__llm-inspector-result';
  document.addEventListener('__llm-inspector-probe', (e) => {
    try {
      const el = e.target;
      if (!el || !el.setAttribute) return;
      const info = extract(el);
      if (info) {
        el.setAttribute(ATTR, JSON.stringify(info));
      } else {
        el.removeAttribute(ATTR);
      }
    } catch (err) {
      // swallow — isolated world will just see no result
    }
  }, true);
})();
