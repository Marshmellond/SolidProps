// Deliberately fictional paths: no CAD files are opened by this test harness.
const property = (name, value) => ({ name, value, evaluated: value, valueType: 'text', writable: true, reason: '' })
const model = (id, name, properties, kind = 'part') => ({
  id, name, path: `C:\\SolidProps-Isolated-Fixture\\${name}`, kind,
  configuration: '', scope: 'document', properties, writable: true, dirty: false, reason: '',
})
const session = { id: 'mock-session', cadId: 'solidworks', label: 'Mock SolidWorks — isolated UI fixture', version: 'Fixture', connectable: true, detail: 'In-memory bridge; no discovery, COM, or CAD processes.' }
const capabilities = { cadId: 'solidworks', displayName: 'Mock SolidWorks', writable: true, notes: '' }
const snapshot = {
  id: 'mock-snapshot-1', sessionId: session.id, cadId: session.cadId, title: 'FixtureAssembly', scope: 'document', warnings: [],
  models: [
    model('root', 'FixtureAssembly.SLDASM', [property('Material', 'Steel'), property('Description', 'Assembly'), property('Code', 'ROOT')], 'assembly'),
    model('part-a', 'PartA.SLDPRT', [property('Material', 'Steel'), property('Description', 'First part'), property('Code', 'A')]),
    model('part-b', 'PartB.SLDPRT', [property('Material', 'Steel'), property('Description', 'Second part')]),
  ],
  root: { id: 'occ-root', name: 'FixtureAssembly', modelId: 'root', status: 'ok', children: [
    { id: 'occ-a-1', name: 'PartA-1', modelId: 'part-a', status: 'ok', children: [] },
    { id: 'occ-a-2', name: 'PartA-2', modelId: 'part-a', status: 'ok', children: [] },
    { id: 'occ-b-1', name: 'PartB-1', modelId: 'part-b', status: 'ok', children: [] },
  ] },
}
module.exports = { session, capabilities, snapshot }
