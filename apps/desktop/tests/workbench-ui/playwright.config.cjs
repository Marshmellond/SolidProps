const { defineConfig } = require('@playwright/test')
const path = require('node:path')
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'workbench.e2e.cjs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: path.resolve(__dirname, '../../../../artifacts/workbench-ui'),
})
