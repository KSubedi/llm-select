# LLM Element Inspector

A minimal Chrome extension that lets you inspect and copy DOM element references in a token-efficient format perfect for LLM prompts. It detects React component names, generates robust CSS selectors, and copies everything to your clipboard in one click.

## Features

- **One-click element inspection** - Click the extension icon or press a keyboard shortcut to enter selection mode
- **Token-efficient output** - Copies only what an LLM needs: URL, CSS selector, tag, text content
- **React component detection** - Automatically detects and includes React component names from fiber trees
- **Smart CSS selectors** - Prioritizes stable locators (`data-testid`, `aria-label`, IDs) over brittle classes
- **Configurable keyboard shortcut** - Default is `Alt+Shift+X`, customizable in Chrome
- **No popup dialogs** - Instant toggle, minimal friction

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `llm-copy` directory

### Chrome Web Store

*(Coming soon)*

## Usage

1. **Toggle selection mode:**
   - Click the extension icon in your toolbar, **or**
   - Press `Alt+Shift+X` (customizable at `chrome://extensions/shortcuts`)

2. **Hover** over any element to see a blue highlight and tag preview

3. **Click** the element to copy its details to your clipboard

4. **Paste** into your LLM prompt

### Example Output

```
u:https://github.com/octocat/Hello-World
s:#submit-btn
t:button
c:SubmitButton
x:"Create pull request"
```

### Cancel Selection

Press `Escape` or click the extension icon again to exit selection mode.

## Project Structure

```
llm-copy/
├── manifest.json       # Extension manifest (Manifest V3)
├── background.js       # Service worker: handles icon click & keyboard shortcuts
├── content.js          # Content script: DOM inspection, React detection, selection logic
├── content.css         # Styles for highlight overlays
├── icons/              # Extension icons (16px, 48px, 128px)
├── LICENSE             # Apache 2.0 license
└── README.md           # This file
```

## How It Works

### CSS Selector Generation
The extension builds selectors by prioritizing (in order):
1. `data-testid`, `data-test`, `aria-label`, `role` attributes
2. Element ID
3. Stable class names (filters out Tailwind-style utility classes)
4. `nth-of-type` index for disambiguation
5. Caps depth at 4 levels to keep selectors short

### React Detection
React stores internal "fiber" data on DOM elements. The extension:
1. Scans elements for React fiber properties (`__reactFiber$...`)
2. Traverses up the fiber tree to find the nearest named component
3. Includes the component name in both hover preview and copied output

This works with function components, class components, forwardRef, and memo wrappers.

## Browser Support

- Chrome / Edge / Brave / Opera (Manifest V3)
- Firefox (requires minor manifest adjustments for Manifest V2)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
