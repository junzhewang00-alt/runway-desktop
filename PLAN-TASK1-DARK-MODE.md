# Plan: Task 1 — Dark Mode + Fix Empty State SVGs

## Overview

Add a `[data-theme='dark']` CSS block to the existing warm glass-morphism design system, a sun/moon toggle in App.tsx with localStorage persistence, and fix empty-state inline SVGs that crash because CSS `var(--*)` values in SVG presentation attributes (stroke/fill) are not rendered correctly in Electron's Chromium.

---

## Files to Modify

| File | Change |
|---|---|
| `src/renderer/theme.css` | Add `[data-theme='dark']` block with dark palette overrides |
| `src/renderer/App.tsx` | Theme toggle button + `data-theme` attribute management + localStorage |
| `src/ui/TaskPanel.tsx` | Move SVG CSS vars from attributes to `style` props |
| `src/ui/MaterialPanel.tsx` | Move SVG CSS vars from attributes to `style` props + define missing `emptyState`/`emptyText`/`emptyHint` styles |
| `src/ui/HistoryPanel.tsx` | Move SVG CSS vars from attributes to `style` props |

---

## Part A: Dark Mode CSS (`theme.css`)

### Current state (lines 4–115)
All CSS custom properties are defined in a single `:root` block. The palette is warm cream / glass morphism:
- `--color-bg: #faf8f5` (warm paper)
- `--color-surface: rgba(255,255,255,0.72)` (translucent glass)
- `--color-text: #2c241c` (dark brown)
- `--color-accent: #c77d5a` (terracotta amber)
- `--color-header-bg: rgba(250,248,245,0.85)`
- `--color-dark-*` family (already dark: `#1e1b18`, `#272420`, etc.) for QueueStatusPanel

### Design approach
Match the existing warm glass-morphism style — NOT pure black. The dark palette should feel like the same design language at night: deep warm browns, lower-luminance surfaces, softened glass translucency.

### Dark palette proposal

```
[data-theme='dark'] {
  /* Accent — slightly brighter terracotta for contrast on dark */
  --color-accent: #d48c6a;
  --color-accent-hover: #c07a58;
  --color-accent-pressed: #a86846;
  --color-accent-subtle: rgba(212, 140, 106, 0.14);
  --color-accent-border: rgba(212, 140, 106, 0.32);

  /* Surfaces — deep warm earth tones with glass translucency */
  --color-bg: #1a1714;
  --color-surface: rgba(40, 36, 32, 0.72);
  --color-surface-hover: rgba(50, 45, 40, 0.88);
  --color-surface-elevated: rgba(45, 40, 35, 0.82);

  /* Borders — warm grey, similar translucency ratio */
  --color-border: rgba(100, 85, 70, 0.25);
  --color-border-light: rgba(90, 80, 65, 0.18);
  --color-border-strong: rgba(110, 95, 78, 0.35);

  /* Text — inverted hierarchy */
  --color-text: #e8e0d5;
  --color-text-secondary: #b0a590;
  --color-text-muted: #7a7060;

  /* Headers */
  --color-header-bg: rgba(26, 23, 20, 0.88);
  --color-header-border: rgba(100, 85, 70, 0.22);

  /* States — adjusted for dark */
  --color-success: #7aad8a;
  --color-success-bg: rgba(122, 173, 138, 0.12);
  --color-warning: #d4a55a;
  --color-warning-bg: rgba(212, 165, 90, 0.12);
  --color-danger: #d4826c;
  --color-danger-bg: rgba(212, 130, 108, 0.12);
  --color-info: #bf9a7c;
  --color-info-bg: rgba(191, 154, 124, 0.12);

  /* Shadows — darker base for depth on dark */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.20);
  --shadow-md: 0 2px 10px rgba(0, 0, 0, 0.25), 0 1px 3px rgba(0, 0, 0, 0.15);
  --shadow-lg: 0 4px 20px rgba(0, 0, 0, 0.30), 0 2px 6px rgba(0, 0, 0, 0.15);
  --shadow-overlay: 0 8px 40px rgba(0, 0, 0, 0.40), 0 2px 8px rgba(0, 0, 0, 0.20);
}
```

### Variables NOT overridden (unchanged across themes)
These are structural/spacing and should stay in `:root` only:
- `--font-sans`, `--font-mono`, `--text-*`, `--weight-*`, `--leading-*`, `--tracking-*`
- `--space-*`, `--radius-*`, `--z-*`, `--transition-*`, `--glass-blur`, `--glass-blur-light`
- `--panel-min-width`, `--divider-width`
- `--color-dark-*` family (these ARE the dark-surface colors for QueueStatusPanel; they remain invariant since that panel already looks dark)

### Key design decisions
1. **Selector: `[data-theme='dark']`** over `@media (prefers-color-scheme: dark)` — gives user explicit control. Can later add a third state "auto" that uses the media query.
2. **Dark surface variables (`--color-dark-*`) unchanged** — QueueStatusPanel already uses a dark terminal aesthetic. The dark palette for the main UI uses a warm earth tone distinct from the terminal dark.
3. **Glass blur unchanged** — the blur/backdrop-filter effect works identically on dark backgrounds.
4. **Shadows: rgba(0,0,0,…)** — on dark backgrounds, shadows need a pure-black base (no warm tint) to read as depth rather than glow. Opacity increased since they're against a dark surface.

### Risk assessment
- **Low risk**: Pure CSS change, no JS dependencies. If dark palette values are wrong, they can be tuned without touching other files.
- **Glass surfaces may need iteration**: The current `rgba(255,255,255,0.72)` surface translucency relies on a light background behind it. The dark equivalent `rgba(40,36,32,0.72)` may look muddy on certain monitors — may need to increase opacity or adjust base color.
- **global.css body background** uses the noise texture + `var(--color-bg)`. Verify the noise texture (a semi-transparent SVG data-URI) overlays correctly on dark.

---

## Part B: Theme Toggle (`App.tsx`)

### Current state
`App.tsx` (327 lines) is the root component with inline styles using CSS variables. No theme management exists. Three panels: left (tasks/history/materials), center (browser), right (queue).

### Implementation steps
1. **Add state**: `const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('runway-theme') as 'light' | 'dark' || 'light')`
2. **Add effect**: `useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('runway-theme', theme); }, [theme])`
3. **Add toggle button** in the header top bar (the area with `styles.topBar` / `styles.header`). Place it at the right edge of the top bar, before the right panel. Use Unicode characters: ☀️/🌙 or simpler SVG paths for sun/moon.
4. **Button style** using existing CSS variables so it auto-adapts to dark mode.

### Location in header
The top bar currently has three sections: panel tabs on the left, some center content, and presumably a right-side area. Place the toggle as a small icon button (`width: 32px, height: 32px`) at the far right of the header bar, with `borderRadius: var(--radius-sm)`, `background: transparent`, hover effect using `var(--color-surface-hover)`.

### Key design decisions
1. **localStorage key**: `'runway-theme'` — scoped to the app, unambiguous.
2. **No IPC needed**: Theme is purely a renderer concern. No preload changes.
3. **Default to light**: matches current behavior for existing users.
4. **`data-theme` on `<html>`**: CSS selector `[data-theme='dark']` scoped to `document.documentElement`.

### Risk assessment
- **Low risk**: Standard React pattern. localStorage is synchronous and fast.
- **SSR/hydration not applicable**: Electron renderer, no SSR.
- **Flash of wrong theme**: The `useState` initializer runs synchronously before first paint, so there should be no flash. However, if the CSS loads after JS, a brief light flash on dark-mode users could occur. Mitigation: add a `<script>` in the HTML shell that reads localStorage and sets `data-theme` before CSS paints (but this is optional — only if the flash is noticeable).

---

## Part C: Fix Empty State SVGs

### The bug
CSS custom properties (`var(--color-accent)`, `var(--color-accent-subtle)`, `var(--color-surface)`) are used directly in SVG presentation attributes (`stroke="var(--color-accent)"`, `fill="var(--color-accent-subtle)"`). In the Electron renderer (Chromium), CSS `var()` references in SVG attribute strings are NOT resolved — they are treated as literal strings and fail to render (stroke/fill become invalid, effectively invisible or black).

### The fix pattern
Move the values from SVG attribute strings into React inline `style` props on each SVG shape element.

**Before (broken):**
```tsx
<rect x="12" y="6" width="36" height="48" rx="4"
  stroke="var(--color-accent)" strokeWidth="1.5"
  fill="var(--color-accent-subtle)" />
```

**After (fixed):**
```tsx
<rect x="12" y="6" width="36" height="48" rx="4"
  strokeWidth="1.5"
  style={{
    stroke: 'var(--color-accent)',
    fill: 'var(--color-accent-subtle)',
  }} />
```

### Files needing the fix (3 files, 3 empty-state SVGs)

#### 1. `src/ui/TaskPanel.tsx` (lines 489–503)

SVG elements to fix:
- `<rect>` — stroke and fill (2 vars)
- `<line>` × 3 — stroke (1 var each)
- `<circle>` — stroke and fill (2 vars)
- `<polyline>` — stroke (1 var)

Total: ~7 CSS var references to move.

#### 2. `src/ui/MaterialPanel.tsx` (lines 110–118)

SVG elements to fix:
- `<rect>` — stroke and fill (2 vars)
- `<circle>` — stroke (1 var)
- `<path>` — stroke (1 var)
- `<polygon>` — fill (1 var)

**Additionally**: The styles object (lines 197–280) is missing `emptyState`, `emptyText`, and `emptyHint` — these are referenced in JSX (lines 109, 116, 117) but never defined. Only `empty` (line 237) exists and is unused. Add the three missing style definitions matching the pattern from TaskPanel.tsx/HistoryPanel.tsx.

#### 3. `src/ui/HistoryPanel.tsx` (lines 114–122)

SVG elements to fix:
- `<circle>` × 2 — stroke and fill (4 vars total)
- `<polyline>` — stroke (1 var)
- `<circle>` (center dot) — fill (1 var)

### Key design decisions
1. **Keep CSS variables in `style` props** — they resolve correctly because React inline styles are applied as CSS, not SVG attributes.
2. **Non-CSS-var attributes stay inline** — `x`, `y`, `width`, `height`, `rx`, `viewBox`, `points`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `opacity`, `fill="none"`, `d` — these are standard SVG attributes that don't reference CSS vars and work fine.
3. **Opacity on SVG elements**: Some elements have `opacity="0.5"` as an SVG attribute. This is fine (it's not a CSS var). Keep as-is.

### Risk assessment
- **Low risk**: Mechanical refactor. Each SVG element's visual output should be identical before and after.
- **Verification**: Run the app, navigate to each panel with zero items, confirm the empty-state illustrations render with correct colors in both light and dark themes.
- **Edge case**: Some SVG attributes like `strokeWidth` are camelCase in React (`strokeWidth`) vs. kebab-case in SVG (`stroke-width`). The existing code already uses camelCase correctly — no change needed.

---

## Implementation Order

1. **Part C first** (SVG fixes) — unblocks proper rendering before dark mode validation
2. **Part A second** (dark CSS) — can be tested immediately with the fixed SVGs
3. **Part B last** (toggle) — wires it all together

## Estimated Lines of Change

| File | Add | Remove | Modify |
|---|---|---|---|
| `src/renderer/theme.css` | ~55 | 0 | 0 |
| `src/renderer/App.tsx` | ~25 | 0 | 0 |
| `src/ui/TaskPanel.tsx` | ~20 | ~15 | 0 |
| `src/ui/MaterialPanel.tsx` | ~25 | ~12 | 0 |
| `src/ui/HistoryPanel.tsx` | ~18 | ~12 | 0 |
| **Total** | **~143** | **~39** | **0** |
