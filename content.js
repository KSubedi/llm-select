(function() {
  // Prevent double-injection
  if (window.__llmInspectorLoaded) return;
  window.__llmInspectorLoaded = true;

  let currentHighlight = null;
  let currentPreview = null;

  // --- React component detection ---
  const __reactCache = new WeakMap();

  function findReactKeys(element) {
    if (!element || typeof element !== 'object') return [];
    try {
      const keys = Object.keys(element);
      return keys.filter(k =>
        k.startsWith('__react') ||
        k.startsWith('__reactInternal') ||
        k.startsWith('_react') ||
        k.includes('reactFiber') ||
        k.includes('reactContainer')
      );
    } catch (e) {
      return [];
    }
  }

  function getFiberTypeName(type) {
    if (!type) return null;
    if (typeof type === 'string') return null;
    if (type.name) return type.name;
    if (type.displayName) return type.displayName;
    if (type.render) {
      if (type.render.name) return type.render.name;
      if (type.render.displayName) return type.render.displayName;
    }
    return null;
  }

  function walkFiber(fiber, maxDepth = 30) {
    let current = fiber;
    let depth = 0;
    const seen = new Set();

    while (current && depth < maxDepth) {
      if (seen.has(current)) break;
      seen.add(current);

      let name = getFiberTypeName(current.type);
      if (name) return name;

      name = getFiberTypeName(current.elementType);
      if (name) return name;

      if (current._debugOwner) {
        name = walkFiber(current._debugOwner, maxDepth - depth);
        if (name) return name;
      }

      current = current.return;
      depth++;
    }
    return null;
  }

  function getReactComponentName(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (__reactCache.has(element)) return __reactCache.get(element);

    let el = element;
    let domDepth = 0;
    const maxDomDepth = 10;

    while (el && el.nodeType === Node.ELEMENT_NODE && domDepth < maxDomDepth) {
      const reactKeys = findReactKeys(el);
      for (const key of reactKeys) {
        const val = el[key];
        if (!val) continue;

        if (typeof val === 'object' && val !== null) {
          const name = walkFiber(val);
          if (name) {
            __reactCache.set(element, name);
            return name;
          }
        }

        if (val._internalRoot && val._internalRoot.current) {
          const name = walkFiber(val._internalRoot.current);
          if (name) {
            __reactCache.set(element, name);
            return name;
          }
        }
      }
      el = el.parentElement;
      domDepth++;
    }

    try {
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && hook.renderers) {
        for (const renderer of hook.renderers.values()) {
          if (renderer.findFiberByHostInstance) {
            const fiber = renderer.findFiberByHostInstance(element);
            if (fiber) {
              const name = walkFiber(fiber);
              if (name) {
                __reactCache.set(element, name);
                return name;
              }
            }
          }
        }
      }
    } catch (e) {}

    __reactCache.set(element, null);
    return null;
  }

  // --- Semantic helpers ---
  const LANDMARKS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'section', 'article']);

  function getLandmarkName(element) {
    const tag = element.nodeName.toLowerCase();
    if (LANDMARKS.has(tag)) return tag;
    const role = element.getAttribute('role');
    if (role) return role;
    return null;
  }

  function getSemanticLabel(element) {
    // Best human-readable label for an element
    if (element.id) return `#${element.id}`;
    const aria = element.getAttribute('aria-label');
    if (aria) return aria;
    const landmark = getLandmarkName(element);
    if (landmark) return `<${landmark}>`;
    const dataTest = element.getAttribute('data-testid') || element.getAttribute('data-test');
    if (dataTest) return `[testid=${dataTest}]`;
    return null;
  }

  function getParentPath(element, maxDepth = 4) {
    const crumbs = [];
    let current = element.parentElement;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && depth < maxDepth) {
      const label = getSemanticLabel(current);
      if (label) crumbs.unshift(label);
      current = current.parentElement;
      depth++;
    }

    return crumbs.join(' > ');
  }

  function getSiblingIndex(element) {
    if (!element.parentElement) return null;
    const siblings = Array.from(element.parentElement.children).filter(s => s.nodeName === element.nodeName);
    if (siblings.length <= 1) return null;
    const idx = siblings.indexOf(element) + 1;
    return `${idx}/${siblings.length}`;
  }

  function generateSimpleSelector(element) {
    // A simple fallback selector without ancestry
    const tag = element.nodeName.toLowerCase();
    if (element.id) return `#${CSS.escape(element.id)}`;

    const strongAttrs = ['data-testid', 'data-test', 'aria-label', 'name'];
    for (const attr of strongAttrs) {
      const val = element.getAttribute(attr);
      if (val) return `${tag}[${attr}="${CSS.escape(val)}"]`;
    }

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c && !isUtilityClass(c));
      if (classes.length > 0) {
        return `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`;
      }
    }

    const siblings = Array.from(element.parentElement?.children || []).filter(s => s.nodeName === element.nodeName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(element) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }

    return tag;
  }

  // Generate a short, robust CSS selector
  function generateCssSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

    const strongAttrs = ['data-testid', 'data-test', 'aria-label', 'aria-labelledby', 'role'];
    for (const attr of strongAttrs) {
      const val = element.getAttribute(attr);
      if (val) {
        const tag = element.nodeName.toLowerCase();
        return `${tag}[${attr}="${CSS.escape(val)}"]`;
      }
    }

    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.nodeName.toLowerCase();

      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }

      let selector = tag;
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c && !isUtilityClass(c));
        if (classes.length > 0) {
          const firstClass = classes[0];
          const siblings = Array.from(current.parentNode?.children || []);
          const sameClass = siblings.filter(s => s.classList.contains(firstClass));
          if (sameClass.length === 1) {
            selector = `${tag}.${CSS.escape(firstClass)}`;
          } else {
            const idx = sameClass.indexOf(current) + 1;
            selector = `${tag}.${CSS.escape(firstClass)}:nth-of-type(${idx})`;
          }
        }
      }

      if (selector === tag && current.parentNode) {
        const siblings = Array.from(current.parentNode.children).filter(s => s.nodeName === current.nodeName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector = `${tag}:nth-of-type(${idx})`;
        }
      }

      parts.unshift(selector);
      current = current.parentNode;

      if (parts.length >= 4) break;
      if (!current || current.nodeType !== Node.ELEMENT_NODE) break;
    }

    return parts.join('>');
  }

  function isUtilityClass(c) {
    const prefixes = ['bg-', 'text-', 'p-', 'm-', 'px-', 'py-', 'mx-', 'my-', 'w-', 'h-', 'flex', 'grid', 'block', 'inline', 'hidden', 'visible', 'rounded', 'border', 'shadow', 'hover:', 'focus:', 'active:', 'sm:', 'md:', 'lg:', 'xl:'];
    return prefixes.some(p => c.startsWith(p));
  }

  function getText(element) {
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const generic = ['click here', 'read more', 'learn more', 'submit', 'cancel', 'ok', 'close'];
    if (generic.includes(text.toLowerCase())) return '';
    return text.length > 120 ? text.slice(0, 120) + '...' : text;
  }

  function inspectElement(element) {
    const info = {
      u: window.location.href,
      s: generateCssSelector(element),
      a: generateSimpleSelector(element),
      t: element.nodeName.toLowerCase()
    };

    const path = getParentPath(element);
    if (path) info.p = path;

    const sib = getSiblingIndex(element);
    if (sib) info.n = sib;

    const comp = getReactComponentName(element);
    if (comp) info.c = comp;

    const text = getText(element);
    if (text) info.x = text;

    return info;
  }

  function formatForLLM(info) {
    let out = `url:${info.u}\nsel:${info.s}\nalt:${info.a}\ntag:${info.t}`;
    if (info.p) out += `\npath:${info.p}`;
    if (info.n) out += `\nnth:${info.n}`;
    if (info.c) out += `\ncomp:${info.c}`;
    if (info.x) out += `\ntxt:"${info.x}"`;
    return out;
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showCopiedToast();
    });
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
      ? '.' + element.className.trim().split(/\s+/).slice(0,2).join('.')
      : '';
    const compName = getReactComponentName(element);
    const compStr = compName ? ` <${compName}>` : '';
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