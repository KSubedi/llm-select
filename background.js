async function toggleInspector(tab) {
  try {
    // Check isolated-world content script
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.__llmInspectorToggle === 'function'
    });

    if (!result) {
      // Check main-world script separately (different world = different globals)
      const [{ result: mainLoaded }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => !!window.__llmInspectorMainLoaded,
      });
      if (!mainLoaded) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-main.js'],
          world: 'MAIN',
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    }

    // Now toggle
    await chrome.scripting.executeScript({
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

chrome.action.onClicked.addListener(async (tab) => {
  await toggleInspector(tab);
});

// Right-click on the extension icon → "Settings"
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'llm-inspector-settings',
    title: 'Settings',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'llm-inspector-settings') {
    chrome.runtime.openOptionsPage();
  }
});

// _execute_action command triggers onClicked automatically, so no extra listener needed