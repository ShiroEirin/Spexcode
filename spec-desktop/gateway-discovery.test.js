'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const http = require('node:http')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

test('desktop discovery attaches to a password-locked gateway through the public identity probe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-desktop-discovery-'))
  const instanceId = 'gateway-instance'
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/host') { res.statusCode = 401; res.end(JSON.stringify({ error: 'authentication required' })); return }
    if (req.url === '/host/identity') { res.end(JSON.stringify({ gateway: { instanceId } })); return }
    res.statusCode = 404; res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const url = `http://127.0.0.1:${port}`
  const recordModule = join(dir, 'host-record.mjs')
  writeFileSync(recordModule, `export function readHostRecord() { return { url: ${JSON.stringify(url)}, instanceId: ${JSON.stringify(instanceId)} } }\n`)
  const previous = process.env.SPEXCODE_DESKTOP_HOST_RECORD_MODULE
  process.env.SPEXCODE_DESKTOP_HOST_RECORD_MODULE = recordModule
  delete require.cache[require.resolve('./gateway-discovery.js')]
  try {
    const { findRunningGateway } = require('./gateway-discovery.js')
    assert.equal(await findRunningGateway(), url)
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_DESKTOP_HOST_RECORD_MODULE
    else process.env.SPEXCODE_DESKTOP_HOST_RECORD_MODULE = previous
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
