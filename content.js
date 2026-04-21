(function() {
  // Prevent double-injection
  if (window.__llmInspectorLoaded) return;
  window.__llmInspectorLoaded = true;

  let currentHighlight = null;
  let currentPreview = null;

  // --- React component detection ---
  function getReactComponentName(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;

    // React 17+ uses keys like __reactFiber$abc123, older uses __reactInternalInstance$...
    const reactKey = Object.keys(element).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!reactKey) return null;

    let fiber = element[reactKey];
    let depth = 0;
    const maxDepth = 20;

    while (fiber && depth < maxDepth) {
      // Named function component or class component
      const type = fiber.type;
      if (type) {
        if (type.name) return type.name;
        if (type.displayName) return type.displayName;
      }
      // Fallback: check elementType for forwardRef/memo
      const et = fiber.elementType;
      if (et) {
        if (et.name) return et.name;
        if (et.displayName) return et.displayName;
      }
      // Traverse up
      fiber = fiber.return || fiber._debugOwner;
      depth++;
    }
    return null;
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
    return text.length > 80 ? text.slice(0, 80) + '...' : text;
  }

  function inspectElement(element) {
    const info = {
      u: window.location.href,
      s: generateCssSelector(element),
      t: element.nodeName.toLowerCase(),
      x: getText(element)
    };
    const comp = getReactComponentName(element);
    if (comp) info.c = comp;
    return info;
  }

  function formatForLLM(info) {
    let out = `u:${info.u}\ns:${info.s}`;
    if (info.t) out += `\nt:${info.t}`;
    if (info.c) out += `\nc:${info.c}`;
    if (info.x) out += `\nx:"${info.x}"`;
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