# Plan: Task 4 — Split `main/index.ts` IPC Handlers

## Overview

Refactor the monolithic `src/main/index.ts` (401 lines) by extracting IPC handler registrations into domain-specific sub-modules. The main file retains only DI wiring, window creation, app lifecycle, and the `withIpcTimeout` utility.

---

## Current Architecture

### What's in `main/index.ts` (401 lines)

| Section | Lines | Content |
|---|---|---|
| Imports | 1–18 | Electron, browser, session, queue, services, adapters, stores, types |
| Module-level state | 20–22 | `isDev`, `mainWindow` |
| `withIpcTimeout` utility | 24–36 | Generic IPC timeout wrapper |
| `createWindow()` | 38–127 | Window creation, BrowserView attach, DI wiring, CDP monitor, log push |
| Validation | 129–233 | `CreateTaskIPCParams`, `ValidationResult`, `validateCreateTaskParams()` |
| IPC Handlers | 235–360 | 20 `ipcMain.handle()` calls across 8 domains |
| App lifecycle | 362–401 | `app.whenReady()`, protocol, shortcuts, `before-quit`, `window-all-closed` |

### Domain grouping (8 domains)

| Domain | Handlers | Primary dependency |
|---|---|---|
| Browser | 5 | `browserManager` |
| Session | 2 | `sessionManager` |
| Queue | 5 + validation | `taskQueue`, `MODEL_CAPS`, `logger` |
| Models | 1 | `modelService` |
| History | 2 | `historyStore`, `MODEL_CAPS` |
| Logger | 1 | `logger` |
| Material | 4 + 1 protocol | `materialService`, `mainWindow` |
| Debug | 1 | `runwayAdapter`, `logger` |

---

## Target Architecture

```
src/main/
├── index.ts                    ← Slimmed: DI wiring, window, lifecycle (~170 lines)
├── shortcuts.ts                ← Unchanged (already extracted)
├── ipc/
│   ├── browser.ts              ← 5 browser handlers
│   ├── session.ts              ← 2 session handlers
│   ├── queue.ts                ← 5 queue handlers + validation
│   ├── models.ts               ← 1 models handler
│   ├── history.ts              ← 2 history handlers
│   ├── logger.ts               ← 1 logger handler
│   ├── material.ts             ← 4 material handlers + protocol
│   └── debug.ts                ← 1 debug handler
└── types/
    └── ipc.ts                  ← Shared IPC types (CreateTaskIPCParams, ValidationResult)
```

---

## Sub-Module Specifications

### Pattern for each sub-module

Every IPC sub-module exports a single `registerHandlers()` function that accepts typed dependencies as a parameter object. This keeps the DI wiring explicit, testable, and visible in `main/index.ts`.

```ts
// Template for each ipc/*.ts file
import { ipcMain } from 'electron'
import { withIpcTimeout } from '../utils/ipc-timeout'  // extracted utility

interface XxxDeps {
  // Only the dependencies this domain needs
}

export function registerHandlers(deps: XxxDeps): void {
  ipcMain.handle('domain:action', withIpcTimeout(async (_event, ...args) => {
    // handler body
  }))
}
```

---

### 1. `src/main/ipc/browser.ts`

**Dependencies:**
```ts
interface BrowserIpcDeps {
  browserManager: BrowserManager
}
```

**Handlers (5):**
| Channel | Delegate |
|---|---|
| `browser:refresh` | `browserManager.reload()` |
| `browser:openDevTools` | `browserManager.openDevTools()` |
| `browser:updateBounds` | `browserManager.setBounds(rect)` |
| `browser:hide` | `browserManager.hide()` |
| `browser:show` | `browserManager.show()` |

**Import in main/index.ts:**
```ts
import { registerHandlers as registerBrowserIpc } from './ipc/browser'
// Called in createWindow() or at module level:
registerBrowserIpc({ browserManager })
```

**Estimated size: ~40 lines**

---

### 2. `src/main/ipc/session.ts`

**Dependencies:**
```ts
interface SessionIpcDeps {
  sessionManager: /* SessionManager type */
}
```

**Handlers (2):**
| Channel | Delegate |
|---|---|
| `session:isLoggedIn` | `sessionManager.isLoggedIn()` |
| `session:clear` | `sessionManager.clearSession()` |

**Estimated size: ~25 lines**

---

### 3. `src/main/ipc/queue.ts`

**Dependencies:**
```ts
interface QueueIpcDeps {
  taskQueue: /* TaskQueue type */
  logger: /* Logger type */
}
```

**This module also exports/internally uses:**
- `CreateTaskIPCParams` interface (moved from main/index.ts lines 131–140)
- `ValidationResult` type (moved from main/index.ts lines 142–151)
- `validateCreateTaskParams()` function (moved from main/index.ts lines 156–233)
- `MODEL_CAPS` import for validation

**Handlers (5):**
| Channel | Delegate |
|---|---|
| `queue:create` | Validate → `taskQueue.create(params)` → return `{success, task}` or `{success:false, errors}` |
| `queue:list` | `taskQueue.list(status)` |
| `queue:updateStatus` | `taskQueue.updateStatus(id, status, error)` |
| `queue:delete` | `taskQueue.delete(id)` |
| `queue:retry` | `taskQueue.retryTask(id)` |

**Design decision**: `validateCreateTaskParams` references `MODEL_CAPS` from `src/types/models`. This import stays in the queue module — it's not a passed dependency, it's a static data import. The `logger` dependency is passed in.

**Estimated size: ~130 lines** (includes the large validation function)

---

### 4. `src/main/ipc/models.ts`

**Dependencies:**
```ts
interface ModelsIpcDeps {
  modelService: /* ModelService type */
}
```

**Handlers (1):**
| Channel | Delegate |
|---|---|
| `models:list` | `modelService.getModels()` |

**Estimated size: ~20 lines**

---

### 5. `src/main/ipc/history.ts`

**Dependencies:**
```ts
interface HistoryIpcDeps {
  historyStore: /* HistoryStore type */
  logger: /* Logger type */
}
```

**Handlers (2):**
| Channel | Delegate |
|---|---|
| `history:list` | Validation (modelId, dateFrom, dateTo) → `historyStore.list(filter, page, pageSize)` |
| `history:getById` | `historyStore.getById(id)` |

**Design decision**: History list validation (modelId check against `MODEL_CAPS`, date type checks) moves with the handler. `MODEL_CAPS` is a static import.

**Estimated size: ~45 lines**

---

### 6. `src/main/ipc/logger.ts`

**Dependencies:**
```ts
interface LoggerIpcDeps {
  logger: /* Logger type */
}
```

**Handlers (1):**
| Channel | Delegate |
|---|---|
| `logger:export` | `logger.exportLogs()` |

**Note**: The log streaming push (`logger.addListener(...)` → `webContents.send('log:new')`) stays in `main/index.ts` `createWindow()`. That is NOT an IPC handler — it's a push from main to renderer.

**Estimated size: ~20 lines**

---

### 7. `src/main/ipc/material.ts`

**Dependencies:**
```ts
interface MaterialIpcDeps {
  materialService: /* MaterialService type */
  materialStore: /* MaterialStore type */
  getMainWindow: () => BrowserWindow | null  // For openDialog
}
```

**Handlers (4):**
| Channel | Delegate |
|---|---|
| `material:openDialog` | `dialog.showOpenDialog(mainWindow, ...)` + return paths |
| `material:import` | `materialService.import(paths)` (30s timeout) |
| `material:list` | `materialService.list()` |
| `material:delete` | `materialService.delete(id)` |

**Also moves**: `material-file` protocol handler (from `app.whenReady()`, lines 367–372). Export a `registerProtocol()` function.

**Design decision**: `mainWindow` is a module-level `let` in `main/index.ts`. Rather than passing it directly (it changes over time — initially `null`, set in `createWindow`), pass a `getMainWindow` getter function. This ensures the dialog always uses the current window reference.

**Material protocol**: Export `registerMaterialProtocol(materialStore)` — called inside `app.whenReady()` in main/index.ts:
```ts
protocol.handle('material-file', (request) => { ... })
```

**Estimated size: ~65 lines**

---

### 8. `src/main/ipc/debug.ts`

**Dependencies:**
```ts
interface DebugIpcDeps {
  runwayAdapter: /* RunwayAdapter type */
  logger: /* Logger type */
}
```

**Handlers (1):**
| Channel | Delegate |
|---|---|
| `debug:diagnose` | `runwayAdapter.diagnosePage()` |

**Estimated size: ~25 lines**

---

### 9. `src/main/utils/ipc-timeout.ts` (NEW)

Extract the `withIpcTimeout` utility from `main/index.ts` (lines 24–36) into a shared utility. All 8 IPC modules import it from here.

```ts
// src/main/utils/ipc-timeout.ts
export function withIpcTimeout<T>(
  handler: (...args: any[]) => Promise<T>,
  timeoutMs = 10_000,
): (...args: any[]) => Promise<T> { ... }
```

**Estimated size: ~15 lines**

---

## What Stays in `main/index.ts`

After extraction, `main/index.ts` retains:

```ts
// 1. Electron imports (app, BrowserWindow, Menu, protocol, net)
// 2. Domain imports for DI (browserManager, sessionManager, taskQueue, etc.)
// 3. IPC registration imports (registerBrowserIpc, registerSessionIpc, etc.)
// 4. Helper imports (registerShortcuts, withIpcTimeout — or re-exported)

// 5. Module-level state
let mainWindow: BrowserWindow | null = null

// 6. createWindow() — DI wiring
async function createWindow(): Promise<void> {
  // Window creation
  // BrowserManager setup
  // SessionManager injection
  // Adapter injection
  // Service wiring
  // CDP monitor start
  // Queue processor/slot checker setup
  // Log push listener
  // Dev/prod URL loading
  // Closed handler
}

// 7. IPC registration block (compact)
registerBrowserIpc({ browserManager })
registerSessionIpc({ sessionManager })
registerQueueIpc({ taskQueue, logger })
registerModelsIpc({ modelService })
registerHistoryIpc({ historyStore, logger })
registerLoggerIpc({ logger })
registerMaterialIpc({ materialService, materialStore, getMainWindow: () => mainWindow })
registerDebugIpc({ runwayAdapter, logger })

// 8. App lifecycle
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerMaterialProtocol(materialStore)  // from material.ts
  createWindow()
  registerShortcuts(mainWindow!)
  app.on('activate', ...)
})

app.on('before-quit', () => { ... })
app.on('window-all-closed', () => { ... })
```

**Estimated remaining size: ~170 lines** (down from 401)

---

## Import Structure

### `main/index.ts` imports

```ts
// Electron
import { app, BrowserWindow, Menu, protocol, net } from 'electron'
import { pathToFileURL } from 'url'

// Domain instances (existing)
import { browserManager, BrowserManager } from '../browser/browser.manager'
import { sessionManager } from '../browser/session.manager'
import { taskQueue } from '../queue/task.queue'
import { generationService } from '../services/generation.service'
import { runwayAdapter } from '../adapters/runway.adapter'
import { logger } from '../logs/logger'
import { modelService } from '../services/model.service'
import { historyStore } from '../database/history.store'
import { materialStore } from '../database/material.store'
import { materialService } from '../services/material.service'
import { downloadManager } from '../download/download.manager'
import { databaseConnection } from '../database/connection'

// IPC modules (new)
import { registerHandlers as registerBrowserIpc } from './ipc/browser'
import { registerHandlers as registerSessionIpc } from './ipc/session'
import { registerHandlers as registerQueueIpc } from './ipc/queue'
import { registerHandlers as registerModelsIpc } from './ipc/models'
import { registerHandlers as registerHistoryIpc } from './ipc/history'
import { registerHandlers as registerLoggerIpc } from './ipc/logger'
import { registerHandlers as registerMaterialIpc, registerMaterialProtocol } from './ipc/material'
import { registerHandlers as registerDebugIpc } from './ipc/debug'

// Shortcuts (existing)
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
```

### Remove from main/index.ts imports
- `ipcMain` (no longer needed — each sub-module imports it)
- `dialog` (moves to material.ts)

### Remove from main/index.ts types
- `CreateTaskIPCParams` interface → `src/main/types/ipc.ts`
- `ValidationResult` type → `src/main/types/ipc.ts`
- `validateCreateTaskParams()` → `src/main/ipc/queue.ts`

---

## File Paths Summary

| File | Action | Est. Lines |
|---|---|---|
| `src/main/index.ts` | Slim down to DI + window + lifecycle | ~170 |
| `src/main/shortcuts.ts` | Unchanged | 0 |
| `src/main/utils/ipc-timeout.ts` | **NEW** — extract `withIpcTimeout` | ~15 |
| `src/main/types/ipc.ts` | **NEW** — shared IPC types | ~25 |
| `src/main/ipc/browser.ts` | **NEW** | ~40 |
| `src/main/ipc/session.ts` | **NEW** | ~25 |
| `src/main/ipc/queue.ts` | **NEW** | ~130 |
| `src/main/ipc/models.ts` | **NEW** | ~20 |
| `src/main/ipc/history.ts` | **NEW** | ~45 |
| `src/main/ipc/logger.ts` | **NEW** | ~20 |
| `src/main/ipc/material.ts` | **NEW** | ~65 |
| `src/main/ipc/debug.ts` | **NEW** | ~25 |
| **Total** | | **~580** |

Net change: ~580 new lines across 10 new files, ~230 lines removed from main/index.ts.

---

## Risk Assessment

### Low risk
- **Mechanical extraction**: Handlers move verbatim. No logic changes.
- **`withIpcTimeout` is a pure utility**: No side effects, no state, trivial to extract.
- **Registration order independence**: Each domain's handlers are independent. The order of `registerXxxIpc()` calls does not matter.

### Medium attention
- **`validateCreateTaskParams` depends on `MODEL_CAPS`**: This is a static import from `src/types/models`. Moving it to `src/main/ipc/queue.ts` means the queue module needs this import. Ensure the import path resolves correctly (`../../types/models` from `src/main/ipc/`).
- **`material:openDialog` needs `mainWindow`**: The window reference is initially `null` and set in `createWindow()`. Using a `getMainWindow` getter ensures the dialog always has the current reference. The IPC handler itself is registered at module load time; the getter is evaluated at call time.
- **`material-file` protocol must be registered in `app.whenReady()`**: Protocol registration has a timing constraint — it must happen after `app.whenReady()` resolves. Exporting `registerMaterialProtocol()` and calling it in the `app.whenReady().then()` block preserves this constraint.
- **`history:list` inline validation references `MODEL_CAPS`**: Same as queue — static import, no DI needed. The `logger.warn()` calls need the `logger` dependency passed in.

### Verification checklist
1. App starts without import errors (`npm run dev` or equivalent)
2. All 8 preload API domains still work (queue, browser, session, models, history, logger, material, debug)
3. `queue:create` validation still rejects invalid params
4. `material:openDialog` still opens the native file dialog
5. `material-file://` protocol still serves images
6. `history:list` still filters by model/date
7. Keyboard shortcuts still work (separate file, unchanged)
8. Shutdown sequence still clean (`before-quit` → stop queue, stop monitor, close DB)

---

## Implementation Order

1. **Extract `withIpcTimeout`** → `src/main/utils/ipc-timeout.ts` (foundation)
2. **Extract IPC types** → `src/main/types/ipc.ts` (shared dependency)
3. **Extract one domain at a time**, starting with the simplest:
   - `logger.ts` (1 handler, simplest)
   - `models.ts` (1 handler)
   - `debug.ts` (1 handler)
   - `session.ts` (2 handlers)
   - `browser.ts` (5 handlers)
   - `history.ts` (2 handlers + inline validation)
   - `material.ts` (4 handlers + protocol, has `mainWindow` dep)
   - `queue.ts` (5 handlers + large validation function, most complex)
4. **Slim `main/index.ts`** — remove moved code, add registration calls
5. **Test each domain** before moving to the next
