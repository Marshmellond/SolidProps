// This is the ONLY main process launched by the workbench suite. Never import src/main or out/main.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { session, capabilities, snapshot } = require('./fixture-data.cjs')
const userData = process.env.CADWEAVE_FIXTURE_USER_DATA
if (!userData || !path.isAbsolute(userData)) throw new Error('Explicit isolated userData is required')
app.setPath('userData', userData)
app.setPath('sessionData', path.join(userData, 'session'))
app.disableHardwareAcceleration()
const clone = value => JSON.parse(JSON.stringify(value))
const state = { calls: [], applies: [], drafts: [], snapshot: clone(snapshot) }
// Inspected only through Playwright Electron main-process evaluation, not exposed to renderer.
globalThis.__workbenchFixture = state
ipcMain.handle('fixture:cad', (_event, method, params) => {
  state.calls.push({ channel: 'cad', method, params: clone(params) })
  if (method === 'discover') return { sessions: [session], diagnostics: [] }
  if (method === 'connect') return { session, capabilities }
  if (method === 'snapshot') return clone(state.snapshot)
  if (method === 'disconnect') return {}
  if (method === 'apply') {
    state.applies.push(clone(params))
    for (const change of params.changes) {
      const model = state.snapshot.models.find(model => model.id === change.modelId)
      const existing = model.properties.find(property => property.name === change.propertyName)
      if (change.operation === 'delete') model.properties = model.properties.filter(property => property !== existing)
      else if (existing) existing.value = existing.evaluated = change.newValue
      else model.properties.push({ name: change.propertyName, value: change.newValue, evaluated: change.newValue, writable: true, valueType: 'text', reason: '' })
    }
    state.snapshot.id = `mock-snapshot-${state.applies.length + 1}`
    return { backupDirectory: '', results: params.changes.map(change => ({ modelId: change.modelId, propertyName: change.propertyName, success: true, saved: true, verified: true, message: 'Mock only; no CAD write' })) }
  }
  throw new Error(`Unexpected CAD fixture method: ${method}`)
})
ipcMain.handle('fixture:local', (_event, method, params) => {
  state.calls.push({ channel: 'local', method, params: clone(params) })
  if (method === 'draft.load') return state.drafts.at(-1) ?? null
  if (method === 'draft.save') {
    const draft = { ...clone(params), savedAt: '2026-01-01T00:00:00.000Z' }
    state.drafts.push(draft)
    return clone(draft)
  }
  if (method === 'draft.delete') { state.drafts = []; return {} }
  throw new Error(`Unexpected local fixture method: ${method}`)
})
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1440, height: 1000, show: true, webPreferences: {
    preload: path.join(__dirname, 'fixture-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } })
  window.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
