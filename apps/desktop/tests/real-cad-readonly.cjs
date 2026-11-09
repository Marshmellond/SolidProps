/* Real Python worker read-only integration: discover → connect → snapshot → disconnect. */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const workerRoot = path.resolve(__dirname, '../../../workers/cad-python')
const command = process.env.CADWEAVE_TEST_EXE || path.join(workerRoot, '.venv/Scripts/python.exe')
const args = process.env.CADWEAVE_TEST_EXE ? [] : ['-m', 'cad_worker']
if (!fs.existsSync(command)) {
  console.error(`Worker executable not found: ${command}`)
  process.exit(1)
}

const child = spawn(command, args, {
  cwd: workerRoot,
  windowsHide: true,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const pending = new Map()
let buffer = ''
let sequence = 0
let stderr = ''

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      console.error('Non-JSON line on stdout:', line)
      process.exit(1)
    }
    const item = pending.get(message.id)
    if (!item) continue
    pending.delete(message.id)
    if (message.error) item.reject(new Error(`${message.error.code}: ${message.error.message}`))
    else item.resolve(message.result)
  }
})
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
child.on('error', (error) => {
  for (const item of pending.values()) item.reject(error)
  pending.clear()
})

function request(method, params = {}, timeoutMs = 30000) {
  const id = `readonly-${++sequence}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Worker timeout: ${method}`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (error) => { clearTimeout(timer); reject(error) },
    })
    child.stdin.write(`${JSON.stringify({ id, method, params, protocolVersion: 1 })}\n`, 'utf8')
  }).catch((error) => {
    if (stderr.trim()) error.message += `\nworker stderr:\n${stderr.trim()}`
    throw error
  })
}

;(async () => {
  try {
    const discovered = await request('discover')
    if (!Array.isArray(discovered.sessions)) throw Error('discover did not return sessions')
    const foreign = discovered.sessions.filter((session) => session.cadId !== 'solidworks')
    if (foreign.length) throw Error(`Unexpected non-SolidWorks sessions: ${JSON.stringify(foreign)}`)
    const session = discovered.sessions.find((item) => item.connectable)
    if (!session) {
      console.log('REAL_CAD_READONLY_SKIP', JSON.stringify({
        reason: 'No connectable SolidWorks session',
        sessions: discovered.sessions.length,
        diagnostics: discovered.diagnostics ?? [],
      }))
      return
    }
    const connected = await request('connect', { sessionId: session.id })
    const snapshot = await request('snapshot', { scope: 'document' })
    if (!snapshot || !Array.isArray(snapshot.models)) throw Error('snapshot did not return models')
    if (!snapshot.models.length) throw Error('snapshot returned zero models')
    let propertyCount = 0
    for (const model of snapshot.models) {
      if (typeof model.id !== 'string' || typeof model.name !== 'string') throw Error(`Invalid model: ${JSON.stringify(model)}`)
      if (!Array.isArray(model.properties)) throw Error(`Model ${model.name} has no properties array`)
      propertyCount += model.properties.length
      for (const property of model.properties) {
        if (typeof property.name !== 'string' || typeof property.value !== 'string') {
          throw Error(`Invalid property on ${model.name}: ${JSON.stringify(property)}`)
        }
      }
    }
    if (propertyCount === 0) {
      throw Error('Connected but read 0 properties; this usually means the SolidWorks version lacks ICustomPropertyManager.Get6 (pre-2018) or the API shape changed')
    }
    await request('disconnect')
    console.log('REAL_CAD_READONLY_PASS', JSON.stringify({
      session: session.label,
      version: connected.session?.version,
      writeCertified: connected.capabilities?.writable,
      title: snapshot.title,
      models: snapshot.models.length,
      properties: propertyCount,
      diagnostics: discovered.diagnostics?.length ?? 0,
      realCadWrites: 0,
    }))
  } finally {
    child.kill()
  }
})().catch((error) => {
  console.error(error)
  child.kill()
  process.exit(1)
})
