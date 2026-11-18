// create_exercise and the note tools through the whole chain: an MCP client over HTTP (http.js), a
// scoped token made by the api's own route, and the real api/server.js in a child process. What the
// unit tests (library-tools.test.js) cannot show: that the token's write is accepted by the api
// (mergeScoped), stamped, kept in the profile's own file, and that each tool is listed only to a
// token that holds the category it needs. Needs api/'s dependencies, like http.e2e.test.js.
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api')
const HAVE_API = fs.existsSync(path.join(API, 'node_modules', '@simplewebauthn', 'server'))
if (!HAVE_API && process.env.CI) throw new Error('api/node_modules is missing: run `npm ci` in api/ before the MCP tests in CI')

const SECRET = crypto.randomBytes(32).toString('hex')
const U = 'u_lib_tools'
const cookie = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}:c`
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const yesterday = () => iso(new Date(Date.now() - 86400000))

let child, dataDir, apiBase, mcp, mcpUrl, log = ''
const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${U}.json`), 'utf8'))
async function makeToken(scopes) {
  const r = await fetch(apiBase + '/api/tokens', { method: 'POST', headers: { Cookie: cookie(U), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test', scopes }) })
  return (await r.json()).token
}
async function connect(token) {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }))
  return client
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content[0].text
  return r.isError ? { error: text } : JSON.parse(text)
}
const toolNames = async client => (await client.listTools()).tools.map(t => t.name).sort()

describe.skipIf(!HAVE_API)('create_exercise and the note tools over HTTP with scoped tokens', () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcp-lib-'))
    fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 })
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: U, name: U, created: new Date().toISOString() }], creds: [], subs: [], invites: [] }))
    fs.writeFileSync(path.join(dataDir, `state-${U}.json`), JSON.stringify({
      unit: 'lb', restSec: 120, routines: [], workouts: [], customEx: [], exNotes: { '0715': 'Hold 30 s' },
      dayNotes: { [yesterday()]: { tag: 'travel', text: 'Detroit', _ts: 5 } },
    }))
    child = spawn(process.execPath, ['server.js'], {
      cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MCP: 'on' },
    })
    child.stderr.on('data', d => { log += d })
    const port = await new Promise((resolve, reject) => {
      const give = setTimeout(() => reject(new Error('server never announced a port:\n' + log)), 20000)
      child.stdout.on('data', d => { log += d; const m = /gym-api on :(\d+)/.exec(log); if (m) { clearTimeout(give); resolve(+m[1]) } })
      child.once('exit', code => { clearTimeout(give); reject(new Error(`server exited (${code}):\n${log}`)) })
    })
    apiBase = `http://127.0.0.1:${port}`
    delete process.env.OPENGYM_DATA
    const { createMcpHandler } = await import('../src/http.js')
    const handle = createMcpHandler({ apiUrl: apiBase, allowedOrigins: ['https://gym.example.com'] })
    mcp = http.createServer((req, res) => handle(req, res))
    await new Promise(r => mcp.listen(0, '127.0.0.1', r))
    mcpUrl = `http://127.0.0.1:${mcp.address().port}/mcp`
  }, 30000)
  afterAll(() => { child?.kill('SIGKILL'); mcp?.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  test('each token sees the tools of its categories only', async () => {
    const plans = await connect(await makeToken({ plans: 'apply' }))
    expect(await toolNames(plans)).toContain('create_exercise')
    expect(await toolNames(plans)).not.toContain('set_exercise_note')
    const notesView = await connect(await makeToken({ notes: 'view' }))
    expect(await toolNames(notesView)).toEqual(['get_notes'])
    const notesApply = await connect(await makeToken({ notes: 'apply' }))
    expect(await toolNames(notesApply)).toEqual(['get_notes', 'set_day_note', 'set_exercise_note'])
    const workouts = await connect(await makeToken({ workouts: 'view' }))
    expect(await toolNames(workouts)).not.toContain('create_exercise')
  })

  test('a token that holds Plans creates an exercise, and it is in the profile and usable in a routine', async () => {
    const client = await connect(await makeToken({ plans: 'apply' }))
    const dry = await call(client, 'create_exercise', { name: 'Balance hold', body_part: 'lower legs', dry_run: true })
    expect(dry).toMatchObject({ saved: false, dry_run: true })
    expect(stored().customEx).toEqual([])
    const made = await call(client, 'create_exercise', { name: 'Balance hold', body_part: 'lower legs', primary_muscles: ['calves'] })
    expect(made).toMatchObject({ saved: true, exercise: { name: 'Balance hold', target: 'calves', equipment: 'body weight' } })
    expect(stored().customEx).toMatchObject([{ id: made.exercise.id, n: 'Balance hold', custom: true, bp: 'lower legs' }])
    const again = await call(client, 'create_exercise', { name: 'balance HOLD', body_part: 'lower legs' })
    expect(again).toMatchObject({ saved: false, problems: [{ field: 'name', candidates: [{ id: made.exercise.id }] }] })
    const routine = await call(client, 'create_routine', { name: 'Equilibre', exercises: [{ exercise: made.exercise.id, sets: 4, seconds: 45 }] })
    expect(routine.saved).toBe(true)
    expect(routine.routine.exercises[0]).toMatchObject({ id: made.exercise.id, sec: 45 })
  })

  test('a token that holds Notes writes and reads both kinds of note, stamped, and touches nothing else', async () => {
    const client = await connect(await makeToken({ notes: 'apply' }))
    const before = stored()
    const ex = await call(client, 'set_exercise_note', { exercise: '0715', text: 'Left side first', mode: 'append' })
    expect(ex).toMatchObject({ saved: true, exercise: { id: '0715' }, note: 'Hold 30 s\nLeft side first', previous_note: 'Hold 30 s' })
    const day = await call(client, 'set_day_note', { date: iso(new Date()), tag: 'rest', text: 'Show day' })
    expect(day).toMatchObject({ saved: true, note: { tag: 'rest', text: 'Show day' } })
    const after = stored()
    expect(after.exNotes['0715']).toBe('Hold 30 s\nLeft side first')
    expect(after.dayNotes[iso(new Date())]).toMatchObject({ tag: 'rest', text: 'Show day' })
    expect(after.dayNotes[yesterday()]).toEqual(before.dayNotes[yesterday()])
    // Nothing outside Notes moved; the api stamped the exercise note (edited["exNotes.<id>"]) and the day entry carries its own _ts.
    expect(after.routines).toEqual(before.routines)
    expect(after.customEx).toEqual(before.customEx)
    expect(typeof after.edited['exNotes.0715']).toBe('number')
    expect(typeof after.dayNotes[iso(new Date())]._ts).toBe('number')
    const notes = await call(client, 'get_notes')
    expect(notes.exercise_notes).toEqual([{ exercise_id: '0715', exercise: 'side plank', note: 'Hold 30 s\nLeft side first' }])
    expect(notes.day_notes.map(n => n.date)).toEqual([iso(new Date()), yesterday()])
    const refused = await call(client, 'set_day_note', { date: iso(new Date(Date.now() + 86400000)), text: 'x' })
    expect(refused).toMatchObject({ saved: false, problems: [{ field: 'date' }] })
  })
})
