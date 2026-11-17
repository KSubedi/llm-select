// Firefox exposes promise-based APIs through browser; Chrome uses chrome.
const extensionAPI = globalThis.browser || globalThis.chrome;

async function toggleInspector(tab) {
  try {
    // Check isolated-world content script
    const [{ result }] = await extensionAPI.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.__llmInspectorToggle === 'function'
    });

    if (!result) {
      // Check main-world script separately (different world = different globals)
      const [{ result: mainLoaded }] = await extensionAPI.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => !!window.__llmInspectorMainLoaded,
      });
      if (!mainLoaded) {
        await extensionAPI.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-main.js'],
          world: 'MAIN',
        });
      }
      await extensionAPI.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    }

    // Now toggle
    await extensionAPI.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof window.__llmInspectorToggle === 'function') {
          window.__llmInspectorToggle();
        } else {
          // Fallback: set flag directly and hope content script catches it
          window.__llmInspectorActive = !window.__llmInspectorActive;
          document.body.style.cursor = window.__llmInspectorActive ? 'crosshair' : '';
        }
      }
    });
  } catch (err) {
    console.error('[LLM Inspector] Toggle failed:', err);
  }
}

extensionAPI.action.onClicked.addListener(async (tab) => {
  await toggleInspector(tab);
});

// Right-click on the extension icon → "Settings"
extensionAPI.runtime.onInstalled.addListener(() => {
  extensionAPI.contextMenus.create({
    id: 'llm-inspector-settings',
    title: 'Settings',
    contexts: ['action'],
  });
});

extensionAPI.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'llm-inspector-settings') {
    extensionAPI.runtime.openOptionsPage();
  }
});

// _execute_action command triggers onClicked automatically, so no extra listener needed