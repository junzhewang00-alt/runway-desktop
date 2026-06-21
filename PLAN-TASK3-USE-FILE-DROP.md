# Plan: Task 3 — Extract `useFileDrop` Hook

## Overview

Extract the duplicated drag-and-drop file-import logic from `MaterialPicker.tsx` and `MaterialPanel.tsx` into a reusable `useFileDrop` custom hook. This is the project's first custom hook — no `hooks/` directory currently exists.

---

## Duplicated Code Analysis

### Identical block (byte-for-byte, 8 lines)

Both files contain this exact file-filtering logic:

```ts
const files = Array.from(e.dataTransfer.files)
const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']
const paths = files
  .filter((f) => {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    return imageExtensions.includes(ext)
  })
  .map((f) => (f as File & { path?: string }).path)
  .filter((p): p is string => typeof p === 'string' && p.length > 0)
```

### Shared patterns (semantically identical, slightly different implementations)

| Concern | MaterialPicker.tsx | MaterialPanel.tsx |
|---|---|---|
| `dragOver` state | `useState(false)` at line 22 | `useState(false)` at line 7 |
| `handleDragOver` | `e.preventDefault(); setDragOver(true)` | `e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true)` |
| `handleDragLeave` | Uses `e.currentTarget.contains(e.relatedTarget)` guard to prevent flicker from child elements | Simple `setDragOver(false)` — no child guard |
| `handleDrop` | Resets `dragOver`, filters files, calls `window.electronAPI.material.import(paths)`, reloads list, auto-selects new items with max-count logic | Resets `dragOver`, filters files, calls `window.electronAPI.material.import(paths)`, reloads list |
| Busy/importing state | `importing` state + `setImporting(true/false)` in try/finally | No busy state |
| Post-import behavior | Selects newly imported items (up to `maxCount`), updates `pickedIds` | Calls `loadMaterials()` |

---

## Hook Interface Design

### File path
`src/ui/hooks/useFileDrop.ts` (new file, create `hooks/` directory)

### Hook signature

```ts
interface UseFileDropOptions {
  /** Called with the filtered file paths. Return a Promise for busy-state tracking. */
  onFiles: (paths: string[]) => Promise<void>;
  /** File extensions to accept (with leading dot). Default: ['.png', '.jpg', '.jpeg', '.webp'] */
  allowedExtensions?: string[];
  /** When true, uses e.currentTarget.contains(e.relatedTarget) in onDragLeave to prevent flicker when dragging over child elements. Default: false */
  preventChildFlicker?: boolean;
}

interface UseFileDropReturn {
  /** Whether a file is currently being dragged over the element */
  dragOver: boolean;
  /** Whether the onFiles callback is currently executing */
  busy: boolean;
  /** Attach to the drop zone element's onDragOver */
  handleDragOver: (e: React.DragEvent) => void;
  /** Attach to the drop zone element's onDragEnter */
  handleDragEnter: (e: React.DragEvent) => void;
  /** Attach to the drop zone element's onDragLeave */
  handleDragLeave: (e: React.DragEvent) => void;
  /** Attach to the drop zone element's onDrop */
  handleDrop: (e: React.DragEvent) => void;
  /** Drag-over visual style to spread onto the element */
  dragStyle: React.CSSProperties;
}
```

### Hook internal logic

```
handleDragEnter(e):
  e.preventDefault()
  e.stopPropagation()
  setDragOver(true)

handleDragOver(e):
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'

handleDragLeave(e):
  if preventChildFlicker AND e.currentTarget.contains(e.relatedTarget as Node):
    return  // still inside the drop zone
  setDragOver(false)

handleDrop(e):
  e.preventDefault()
  e.stopPropagation()
  setDragOver(false)

  paths = extractPaths(e.dataTransfer.files, allowedExtensions)
  if paths.length === 0: return

  setBusy(true)
  try:
    await onFiles(paths)
  finally:
    setBusy(false)

extractPaths(fileList, extensions):
  return Array.from(fileList)
    .filter(f => extensions.includes('.' + f.name.split('.').pop()?.toLowerCase()))
    .map(f => (f as File & { path?: string }).path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
```

### Key design decisions

1. **`dragStyle` return value**: Instead of requiring consumers to know the CSS class or inline style for drag-over feedback, the hook returns a pre-built style object (`{ outline: '...', background: '...' }`) or `undefined` that the consumer spreads onto the drop zone element. This keeps visual concerns near the hook while letting the consumer override if needed.

2. **`preventChildFlicker` option**: MaterialPicker uses this guard (it has a complex grid of child elements); MaterialPanel does not (its drop zone is simpler). Making it optional with default `false` matches the simpler/common case.

3. **`busy` state**: MaterialPicker has `importing` state; MaterialPanel does not. The hook provides `busy` for consumers that want to show a loading indicator during `onFiles`.

4. **No IPC coupling**: The hook is pure drag-drop logic. It does NOT import `window.electronAPI`. The `onFiles` callback is where consumers wire up IPC calls. This keeps the hook testable and reusable for non-material file drops.

5. **`handleDragEnter` in addition to `handleDragOver`**: Some drag implementations need `dragEnter` to set state (to handle the case where drag starts outside and enters). Both `enter` and `over` set `dragOver = true` for robustness.

6. **`e.stopPropagation()` in handlers**: Prevents parent drop zones from interfering when nested drop zones exist (e.g., TaskPanel's textarea drop zone inside a larger panel).

---

## What to Remove from Each Component

### MaterialPicker.tsx

**Remove:**
- `dragOver` state declaration (line 22, `const [dragOver, setDragOver] = useState(false)`)
- `importing` state declaration (line ~23, `const [importing, setImporting] = useState(false)`)
- `handleDragOver` inline handler (lines ~118–119)
- `handleDragLeave` inline handler (lines ~120–122)
- `handleDrop`: file-filtering block (lines 122–130) — the `Array.from(e.dataTransfer.files)` through `.filter(paths)` section
- `handleDrop`: `setImporting(true)` / `setImporting(false)` wrapping (lines 134, 149)
- Any `drag-over` CSS class toggling replaced by `dragStyle`

**Keep:**
- The `onFiles` callback body: `window.electronAPI.material.import(paths)` + `window.electronAPI.material.list()` + `setMaterials(list)` + `setPickedIds` logic (lines 134–150, minus the try/finally busy wrapper)
- Everything else: state, JSX, styles, modal logic

**Refactor pattern:**
```tsx
const { dragOver, busy, handleDragOver, handleDragLeave, handleDrop, dragStyle } = useFileDrop({
  onFiles: async (paths) => {
    const imported = await window.electronAPI.material.import(paths)
    const list = await window.electronAPI.material.list()
    setMaterials(list)
    const newIds = imported.map((m) => m.id)
    setPickedIds((prev) => {
      const next = new Set(prev)
      for (const id of newIds) {
        if (next.size >= maxCount) break
        next.add(id)
      }
      return next
    })
  },
  preventChildFlicker: true,
})
```

### MaterialPanel.tsx

**Remove:**
- `dragOver` state declaration (line 7)
- `handleDragOver` inline handler (lines 53–56)
- `handleDragLeave` inline handler (lines 57–59)
- `handleDrop`: file-filtering block (lines 66–76)
- `handleDrop`: `if (paths.length > 0)` guard (the hook already handles this)
- `styles.dragging` / drag-over style toggle (replaced by `dragStyle`)

**Keep:**
- The `onFiles` callback body: `window.electronAPI.material.import(paths)` + `loadMaterials()` (lines 78–81)
- Material card drag-out handlers (`onDragStart`, `draggable`) — these are NOT file-drop and stay
- Everything else: state, JSX, styles

**Refactor pattern:**
```tsx
const { dragOver, handleDragOver, handleDragLeave, handleDrop, dragStyle } = useFileDrop({
  onFiles: async (paths) => {
    await window.electronAPI.material.import(paths)
    loadMaterials()
  },
  // preventChildFlicker defaults to false — appropriate for panel container
})
```

---

## New File Structure

```
src/ui/hooks/useFileDrop.ts    ← NEW: the hook
src/ui/MaterialPicker.tsx      ← MODIFIED: removes ~20 lines, adds ~8 lines
src/ui/MaterialPanel.tsx       ← MODIFIED: removes ~18 lines, adds ~7 lines
```

### `src/ui/hooks/useFileDrop.ts` structure

```
// 1. Interface exports: UseFileDropOptions, UseFileDropReturn
// 2. Internal helper: extractPaths(fileList, extensions) → string[]
// 3. Hook function: useFileDrop(options) → UseFileDropReturn
// 4. Default export
```

Approximate size: ~70 lines.

---

## Risk Assessment

### Low risk
- The hook is mechanically extracted from working code. The file-filtering logic is byte-identical.
- Both components share the same dependency (`window.electronAPI.material.import`), so the `onFiles` callback shape is consistent.

### Medium attention
- **MaterialPicker's `preventChildFlicker`**: The grid has many child elements. The `e.currentTarget.contains(e.relatedTarget)` guard prevents `dragOver` from flickering false when the cursor passes over a child element. Must ensure the hook implements this identically.
- **MaterialPanel's card drag-out**: MaterialPanel has BOTH file-drop (import) AND card-drag-out (export to TaskPanel). The `handleDragOver`/`handleDragLeave`/`handleDrop` for file-drop must NOT interfere with the card `onDragStart` handlers. Since card drags use a custom `dataTransfer.setData('application/x-runway-material-ids', ...)` MIME type (not files), the `handleDrop` in the hook will see `e.dataTransfer.files` as empty (length 0) and short-circuit — no conflict.
- **State naming collision**: Both components currently use `dragOver`. With the hook, they destructure `{ dragOver }` from the hook return. If either component uses `dragOver` for another purpose, rename the destructured value. Currently neither does.

### Verification
1. Dragging a PNG from Explorer into MaterialPicker: imports, selects, respects maxCount.
2. Dragging multiple images into MaterialPanel: imports all, list refreshes.
3. Dragging a non-image file (.txt): nothing happens (filtered out).
4. Dragging a material card from MaterialPanel to TaskPanel: still works (card `onDragStart` uses custom MIME type, unrelated to file-drop).
5. Drag-over visual feedback: both components show outline/background change during drag.
6. Rapid double-drop: busy state prevents concurrent imports.

---

## Estimated Lines of Change

| File | Add | Remove | Net |
|---|---|---|---|
| `src/ui/hooks/useFileDrop.ts` | ~70 | 0 | +70 |
| `src/ui/MaterialPicker.tsx` | ~8 | ~20 | -12 |
| `src/ui/MaterialPanel.tsx` | ~7 | ~18 | -11 |
| **Total** | **~85** | **~38** | **+47** |
