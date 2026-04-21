async function toggleInspector(tab) {
  try {
    // Check if content script is already loaded
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => typeof window.__llmInspectorToggle === 'function'
    });

    // If not loaded, inject content.js first
    if (!result) {
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

// _execute_action command triggers onClicked automatically, so no extra listener needed