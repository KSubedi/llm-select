# LLM Element Inspector

A minimal Chrome extension that lets you inspect and copy DOM element references in a token-efficient format perfect for LLM prompts. It detects React component names, generates robust CSS selectors, and copies everything to your clipboard in one click.

## Why this exists

The goal is to help you quickly point things out to your coding agent. Instead of describing where something is on a page, just select it and paste the reference.

For example, you select a button and tell your agent:

> "Make this button blue"  
> `url:https://myapp.com/dashboard`  
> `sel:#submit-btn`  
> `alt:button.btn-primary`  
> `tag:button`  
> `path:header > nav`  
> `nth:2/3`  
> `comp:SubmitButton`  
> `txt:"Create account"`

The agent now knows exactly which element you're talking about, even in a large React codebase.

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
url:https://github.com/octocat/Hello-World
sel:#submit-btn
alt:button.btn-primary
tag:button
path:header > nav > ul
nth:2/5
comp:SubmitButton
txt:"Create pull request"
```

**Fields explained:**

| Key | Meaning | Why it helps the LLM |
|---|---|---|
| `url` | **URL** | Knows which page |
| `sel` | **Best selector** | Most robust unique locator (e.g. `data-testid`, ID, class path) |
| `alt` | **Alt selector** | Simple fallback without ancestry (e.g. `button.btn-primary`) |
| `tag` | **Tag** | Knows it's a `<button>` vs `<a>` vs `<div>` |
| `path` | **Parent path** | Semantic breadcrumbs: `header > nav > ul` gives structural context |
| `nth` | **Sibling index** | "2nd button of 5" — disambiguates when multiple similar elements exist |
| `comp` | **React component** | Jumps straight to the source file: `SubmitButton.jsx` |
| `txt` | **Text content** | Semantic label the LLM can grep for |

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
The extension builds **two selectors** for redundancy:

**Primary (`s`)** — most robust unique locator, built from the element up:
1. `data-testid`, `data-test`, `aria-label`, `role` attributes
2. Element ID
3. Stable class names (filters out Tailwind-style utility classes)
4. `nth-of-type` index for disambiguation
5. Caps depth at 4 levels

**Alternative (`a`)** — simple fallback without ancestry:
- Just the tag + key attributes or classes, so it still works if the page structure changes

### Semantic Parent Path (`p`)
Walks up the DOM collecting meaningful landmarks:
- HTML5 semantic tags: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`, `<section>`, `<article>`
- ARIA roles
- Element IDs and `aria-label` attributes

This gives the LLM human-readable context like `header > nav > user-menu`.

### Sibling Index (`n`)
Computes the element's position among same-tag siblings: `2/5` means "2nd button of 5 in this container." This disambiguates lists, toolbars, and grids where multiple similar elements exist.

### React Detection
React stores internal "fiber" data on DOM elements. The extension:
1. Scans elements for React fiber properties (`__reactFiber$...`)
2. Traverses up the fiber tree to find the nearest named component
3. Falls back to React DevTools hook if installed
4. Includes the component name in both hover preview and copied output

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
