# Isolated production-renderer workbench smoke tests

From the repository root, build the renderer and run:

```powershell
pnpm --filter @solidprops/desktop build
pnpm --dir apps/desktop exec playwright test --config tests/workbench-ui/playwright.config.cjs
```

Or from `apps/desktop`:

```powershell
pnpm exec playwright test --config tests/workbench-ui/playwright.config.cjs
```

No dependencies are added. The suite uses the installed `@playwright/test` Electron launcher and bundled Electron; no browser download is needed. A missing production renderer produces a build-first error. Rebuild after changing renderer source: this deliberately tests `out/renderer/index.html`, not a dev server.

## Safety boundary

- Electron launches only `fixture-main.cjs`; it never imports or launches the application main, worker, CAD discovery code, SolidWorks, or COM.
- A dedicated preload exposes a mocked `window.cadweave` through Electron `contextBridge` with context isolation and renderer sandbox enabled.
- CAD discover/connect/snapshot/apply and local draft/history methods are strictly allowlisted, in-memory fixture handlers. Unexpected methods fail rather than falling through to native application behavior.
- Each test creates a fresh OS temporary directory and explicitly assigns Electron `userData` and `sessionData` before readiness. The real app's user data is never consulted. Only that verified temporary directory is removed during teardown.
- Three fictional unique files (root assembly and two parts) include common/mixed/missing properties. The root references PartA twice. No model file is read or written.
- Apply payloads and draft/history calls are inspected in the test main process; fixture inspection is not exposed to renderer code.
- Playwright output goes to the already-ignored root `artifacts/workbench-ui` directory.
- The test is named `workbench.e2e.cjs`, with an explicit Playwright `testMatch`, so Vitest's default `.test`/`.spec` discovery does not execute the Electron suite.
- The multi-file test checks nonzero panel geometry, viewport bounds, no document horizontal overflow, non-overlapping sidebar/property panels, and a nonempty screenshot artifact. Screenshot capture is not a substitute for human visual inspection.

## Coverage

5. View-only double-click never opens or focuses an editor; single and aggregate editable controls have visible borders before focus. Pending states use 待提交, with operation types in titles.
6. Ten continuous file/structure roundtrips exercise full-width tab edge hit targets, independent search strings, single-occurrence focus, and file selection.
7. Batch property union contains selected files only; common-only excludes partial coverage and query does not silently add unselected properties.


1. Connect into the default unique-file sidebar; root and duplicate-reference badge; plain-text property values and disabled actions before explicit editing; multiple file checkbox selection unlocks bulk editing only after entering edit mode; file and property queries retain selection; no matrix/results panel.
2. Missing-property default skips absent files; explicit fill adds absent property; save gates submit; preview alone never applies; confirm captures exact update/add payload and snapshot ID; mock success refreshes and clears pending submission.
3. Mixed-value blank default cannot accidentally clear values; explicit clear stages empty values; saved draft remains local. Structure navigation locates a repeated part but highlights only the clicked occurrence; switching back preserves exactly one underlying file selection.
4. Explicit bulk add skips existing properties and adds only the missing one. Delete withdraws a pending add and marks existing properties for deletion. Cancel confirmation restores the saved draft. Deleting with a genuinely missing property skips that file; saved delete entries contain only the two existing properties, with no apply call.
