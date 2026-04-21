# LLM Element Inspector

A minimal Chrome extension that lets you inspect and copy DOM element references in a format perfect for LLM prompts. It detects component names across React, Vue, Svelte, Angular, and Solid, finds source file locations in dev builds, generates validated CSS selectors, and copies everything to your clipboard in one click.

## Why this exists

The goal is to help you quickly point things out to your coding agent. Instead of describing where something is on a page, just select it and paste the reference.

For example, you select a button and tell your agent:

> "Make this button blue"
>
> ```xml
> <CodeReference>
> url: https://myapp.com/dashboard
> sel: nav>button[data-testid="submit"]
> tag: button
> comp: SubmitButton
> ancestors: CheckoutForm > PaymentStep
> src: src/components/SubmitButton.tsx:42
> fw: react
> state: type=submit, disabled
> txt: Create account
> </CodeReference>
> ```

The agent now has everything it needs — exact file path, line number, component name, parent chain, selector, state, and text. It can jump straight to the right file and make the change.

The `<CodeReference>` wrapper makes it obvious to the model that this is context (not content to respond to) while the compact `key: value` body keeps token usage low.

## Features

- **One-click element inspection** — Click the extension icon or press a keyboard shortcut to enter selection mode
- **XML output tuned for LLMs** — tag-delimited, with an inline `<Instruction>` so weak models know what to do with the blob
- **Multi-framework component detection** — React, Vue 2/3, Svelte, Angular, Solid
- **Component ancestor chain** — when the clicked node is a plain `<div>`, the parent components still surface so the agent has a grep anchor
- **Source file detection** — In dev builds, gets the exact `file:line` from React fiber debug data
- **Validated CSS selectors** — Every selector is tested with `querySelectorAll` to verify it uniquely matches the target element
- **Route extraction** — route path surfaces separately from the full URL so query strings don't dilute the signal
- **Smart context** — Finds associated `<label>`, nearby headings, `aria-label`, placeholders
- **Element state** — Captures `href`, `disabled`, `checked`, `aria-expanded`, input type/value, and more
- **Configurable** — Settings page to toggle fields and choose output format (XML / YAML / JSON / plain English)
- **Keyboard shortcut** — Default is `Alt+Shift+X`, customizable in Chrome
- **No popup dialogs** — Instant toggle, minimal friction

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

### Configuration

Right-click the extension icon → **Options** (or visit `chrome://extensions/` and click Details → Extension options).

You can customize:
- **Output format:** XML (default), YAML-ish, JSON, or plain English sentence
- **Which fields to include:** toggle each field on/off to minimize token usage

### Cancel Selection

Press `Escape` or click the extension icon again to exit selection mode.

## Output Format

Default XML output — a lightweight `<CodeReference>` wrapper around a compact `key: value` body:

```xml
<CodeReference>
url: https://myapp.com/dashboard
sel: nav>button[data-testid="submit"]
tag: button
comp: SubmitButton
ancestors: CheckoutForm > PaymentStep
src: src/components/SubmitButton.tsx:42
fw: react
label: near-heading: "Account"
state: type=button, disabled
txt: Create account
</CodeReference>
```

### Fields

| Key | Meaning | Why it helps the LLM |
|---|---|---|
| `url` | Page URL | Knows which page |
| `sel` | **Validated** CSS selector | Guaranteed to uniquely match the target element |
| `tag` | HTML tag | Knows it's a `<button>` vs `<a>` vs `<div>` |
| `comp` | Component name | Points to React/Vue/Svelte/etc. component |
| `ancestors` | Parent component chain | Grep anchor when the clicked node is a plain `<div>` inside a named component |
| `src` | Source file + line | Jumps straight to the right file (dev builds only) |
| `fw` | Framework | Which framework was detected |
| `label` | Associated label / nearby heading | Gives semantic context ("this is the email field", "in the Account section") |
| `state` | Element state | `href`, `disabled`, `checked`, `type`, `aria-*` — tells LLM what the element does |
| `txt` | Text content | Semantic label the LLM can grep for |

Only non-empty fields are included. Toggle any field off in settings to save tokens. Alternate formats (YAML / JSON / sentence) are still available.

## How It Works

### Validated CSS Selector
Rather than generating a selector and hoping it works, the extension:
1. Tries stable attributes first: `data-testid`, `data-test`, `data-cy`, `data-qa`, `aria-label`, `name`
2. Tries the element ID
3. Builds a selector bottom-up, using classes and `nth-of-type` for disambiguation
4. At each step, runs `querySelectorAll(selector)` and stops when it uniquely matches the target
5. Skips Tailwind-style utility classes (`bg-`, `p-`, `flex`, etc.) that change often

**This means `sel` is guaranteed to work.** No broken selectors.

### Component Detection
Detects components across:
- **React** — reads fiber tree via `__reactFiber$...` properties; falls back to React DevTools hook
- **Vue 2** — reads `__vue__.$options.name`
- **Vue 3** — reads `__vueParentComponent.type.__name` and `__file`
- **Svelte** — reads dev-mode `__svelte*` keys
- **Angular** — uses `window.ng.getComponent()` when available
- **Solid** — reads `_$owner.componentName`

For React forwardRef/memo/lazy wrappers, unwraps them to find the real name.

### Source File Detection (React)
In development builds, React's JSX transform adds `_debugSource` with `fileName` and `lineNumber` to every fiber. The extension extracts this and shortens the path to something readable like `src/components/SubmitButton.tsx:42`.

This works when Babel's `@babel/plugin-transform-react-jsx-source` is active (default in `create-react-app`, Next.js dev, Vite React, etc.). It does not work in production builds.

### Semantic Label Detection
For form elements, finds the associated `<label>` via:
1. `aria-label` attribute
2. `aria-labelledby` referencing another element
3. `<label for="id">`
4. Wrapping `<label>`
5. `placeholder` attribute

For other elements, finds the nearest preceding heading for structural context.

### Element State Capture
Depending on element type, includes:
- Links: `href`
- Images: `alt`
- Inputs: `type`, `value`, `disabled`, `required`, `checked`
- Buttons: `disabled`
- Selects: number of options
- Any element: `aria-expanded`, `aria-checked`, `aria-selected`

## Project Structure

```
llm-copy/
├── manifest.json       # Extension manifest (Manifest V3)
├── background.js       # Service worker: handles icon click & keyboard shortcuts
├── content.js          # Content script: DOM inspection, framework detection, selection logic
├── content.css         # Styles for highlight overlays
├── options.html        # Settings page UI
├── options.js          # Settings page logic
├── icons/              # Extension icons (16px, 48px, 128px)
├── LICENSE             # Apache 2.0 license
└── README.md           # This file
```

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
