// create_exercise, get_notes, set_exercise_note and set_day_note against a stand-in for the api (a
// node:http server that answers /api/me and /api/data the way api/server.js does and records what
// it is sent), as write-tools.test.js does for log_workout. The rules themselves are in
// frontend/src/lib/exercise-write.test.js and notes-write.test.js.
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { createExerciseTool } from '../src/exercise-tools.js'
import { getNotes, setExerciseNoteTool, setDayNoteTool } from '../src/note-tools.js'
import { createRoutineTool } from '../src/routine-tools.js'
import { toolAllowed, ALL_TOOLS, TOOL_NEEDS } from '../src/server.js'
import { _resetWriteWindow } from '../src/write-tools.js'
import { _seedStateForTests } from '../src/state.js'

const TOKEN = 'tok.secret-value'
const UID = 'u1'
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const today = () => iso(new Date())
const yesterday = () => iso(new Date(Date.now() - 86400000))
const tomorrow = () => iso(new Date(Date.now() + 86400000))

let api
function stubApi(doc) {
  const s = { doc: structuredClone(doc), rev: 7, puts: [] }
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'not signed in' })
    if (req.url === '/api/me') return send(200, { user: { id: UID, name: 'Carl' }, token: 'renewed.secret' })
    if (req.url === '/api/data' && req.method === 'GET') return send(200, { state: s.doc, rev: s.rev })
    if (req.url === '/api/data' && req.method === 'PUT') {
      let raw = ''
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      s.puts.push(body)
      if (body.baseRev !== s.rev) return send(409, { error: 'conflict', rev: s.rev, state: s.doc })
      s.doc = body.state
      s.rev++
      return send(200, { ok: true, rev: s.rev })
    }
    send(404, { error: 'not found' })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    s.server = server
    s.env = { OPENGYM_URL: `http://127.0.0.1:${server.address().port}`, OPENGYM_TOKEN: TOKEN }
    resolve(s)
  }))
}
afterEach(() => api?.server.close())
beforeEach(() => _resetWriteWindow())

const DOC = () => ({ unit: 'lb', workouts: [], routines: [], customEx: [], exNotes: {}, dayNotes: {}, _wid: 'w-abc', _ts: 1 })
const run = (tool, params) => tool.handler(params, { env: api.env })

describe('create_exercise', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('dry run previews and saves nothing', async () => {
    const r = await run(createExerciseTool, { name: 'Wall angel', body_part: 'shoulders', primary_muscles: ['rear-delts'], dry_run: true })
    expect(r).toMatchObject({ saved: false, dry_run: true, would_save: { exercise: { name: 'Wall angel', body_part: 'shoulders', target: 'rear-delts', equipment: 'body weight' } } })
    expect(api.puts).toHaveLength(0)
  })

  test('saves the exercise in customEx, over the revision it read, and returns its id', async () => {
    const r = await run(createExerciseTool, { name: 'Wall angel', body_part: 'shoulders', description: 'Back flat' })
    expect(r.saved).toBe(true)
    expect(r.exercise).toMatchObject({ name: 'Wall angel', description: 'Back flat', category: 'own exercise' })
    expect(api.puts).toHaveLength(1)
    expect(api.puts[0]).toMatchObject({ baseRev: 7, baseWid: 'w-abc' })
    const saved = api.doc.customEx
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ id: r.exercise.id, n: 'Wall angel', bp: 'shoulders', custom: true })
  })

  test('a name the library has comes back as a problem with that exercise, and nothing is saved', async () => {
    const r = await run(createExerciseTool, { name: 'Side plank', body_part: 'waist' })
    expect(r.saved).toBe(false)
    expect(r.problems[0]).toMatchObject({ field: 'name', candidates: [{ id: '0715' }] })
    expect(api.puts).toHaveLength(0)
  })

  test('the new exercise can go in a routine by name straight away', async () => {
    const made = await run(createExerciseTool, { name: 'Balance hold', body_part: 'lower legs' })
    const r = await run(createRoutineTool, { name: 'Test', exercises: [{ exercise: 'balance hold', sets: 4, seconds: 45 }] })
    expect(r.saved).toBe(true)
    expect(r.routine.exercises[0]).toMatchObject({ id: made.exercise.id, mode: 'time', sets: 4, sec: 45 })
  })
})

describe('notes', () => {
  beforeEach(async () => { api = await stubApi({ ...DOC(), exNotes: { '0715': 'Hold 30 s' }, dayNotes: { [yesterday()]: { tag: 'travel', text: 'Detroit', _ts: 5 } } }) })

  test('set_exercise_note replaces the note by default and says what it replaced', async () => {
    const r = await run(setExerciseNoteTool, { exercise: '0715', text: 'Hold 45 s, breathe' })
    expect(r).toMatchObject({ saved: true, exercise: { id: '0715', name: 'side plank' }, note: 'Hold 45 s, breathe', previous_note: 'Hold 30 s' })
    expect(api.doc.exNotes['0715']).toBe('Hold 45 s, breathe')
  })

  test('append adds a line, and a second identical append changes nothing but still reports the note', async () => {
    const a = await run(setExerciseNoteTool, { exercise: '0715', text: 'Left side first', mode: 'append' })
    expect(a.note).toBe('Hold 30 s\nLeft side first')
    const b = await run(setExerciseNoteTool, { exercise: '0715', text: 'Left side first', mode: 'append' })
    expect(b.note).toBe('Hold 30 s\nLeft side first')
  })

  test('an unknown exercise is a problem, nothing is saved', async () => {
    const r = await run(setExerciseNoteTool, { exercise: 'qwertyuiop asdfghjkl', text: 'x' })
    expect(r.saved).toBe(false)
    expect(r.problems[0].field).toBe('exercise')
    expect(api.puts).toHaveLength(0)
  })

  test('set_day_note writes a stamped day entry; a future day is refused', async () => {
    const r = await run(setDayNoteTool, { date: today(), tag: 'rest', text: 'Show day' })
    expect(r).toMatchObject({ saved: true, date: today(), note: { tag: 'rest', text: 'Show day' }, previous_note: null })
    expect(api.doc.dayNotes[today()]).toMatchObject({ tag: 'rest', text: 'Show day' })
    expect(typeof api.doc.dayNotes[today()]._ts).toBe('number')
    const future = await run(setDayNoteTool, { date: tomorrow(), text: 'x' })
    expect(future.saved).toBe(false)
    expect(future.problems[0].field).toBe('date')
  })

  test('get_notes reads both kinds, with the exercise\'s name', async () => {
    _seedStateForTests(api.doc)
    const r = getNotes.handler({})
    expect(r.exercise_notes).toEqual([{ exercise_id: '0715', exercise: 'side plank', note: 'Hold 30 s' }])
    expect(r.day_notes).toEqual([{ date: yesterday(), tag: 'travel', text: 'Detroit' }])
    expect(r.day_note_tags).toEqual(['sick', 'travel', 'rest', 'injured'])
  })
})

describe('which token sees which tool', () => {
  const t = over => ({ workouts: 'off', plans: 'off', bodyweight: 'off', measurements: 'off', notes: 'off', ...over })

  test('every tool has a stated need', () => {
    for (const tool of ALL_TOOLS) expect(TOOL_NEEDS[tool.name], tool.name).toBeTruthy()
  })

  test('notes tools need the Notes category; create_exercise needs Plans or Workouts at Change directly', () => {
    expect(toolAllowed('get_notes', t({ notes: 'view' }))).toBe(true)
    expect(toolAllowed('set_exercise_note', t({ notes: 'view' }))).toBe(false)
    expect(toolAllowed('set_exercise_note', t({ notes: 'apply' }))).toBe(true)
    expect(toolAllowed('set_day_note', t({ plans: 'apply' }))).toBe(false)
    expect(toolAllowed('create_exercise', t({ plans: 'apply' }))).toBe(true)
    expect(toolAllowed('create_exercise', t({ workouts: 'apply' }))).toBe(true)
    expect(toolAllowed('create_exercise', t({ plans: 'view', workouts: 'view', notes: 'apply' }))).toBe(false)
    expect(toolAllowed('create_exercise', null)).toBe(true)
  })
})
