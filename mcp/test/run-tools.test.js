// list_activities, get_run_summary, log_activity, import_garmin_activities and set_run_plan against a
// stand-in for the api (as library-tools.test.js does). The rules are in frontend/src/lib/
// activities.test.js, activities-garmin.test.js and run-plan.test.js.
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { listActivities, getRunSummary, logActivity, importGarminActivities, setRunPlan } from '../src/run-tools.js'
import { getWeekPlan } from '../src/tools.js'
import { getRunSession, setRunSession, linkActivityToSession } from '../src/session-tools.js'
import { toolAllowed, ALL_TOOLS, TOOL_NEEDS } from '../src/server.js'
import { _resetWriteWindow } from '../src/write-tools.js'
import { _seedStateForTests } from '../src/state.js'

const TOKEN = 'tok.secret-value'
const UID = 'test-uid'
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const day = n => iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + n, 12))

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

const DOC = () => ({ unit: 'lb', workouts: [], routines: [], customEx: [], activities: {}, runPlan: {}, dayPlan: {}, week: {}, queue: null, programmes: [], _wid: 'w-abc', _ts: 1 })
const run = (tool, params) => tool.handler(params, { env: api.env })
const GARMIN = (over = {}) => ({ id: 777, date: day(-1), start: `${day(-1)} 08:00:00`, type: 'trail_running', name: 'Trail', km: 12, hours: 1.5, climb_m: 700, descent_m: 690, avg_hr: 150, max_hr: 170, zones: [0, 2000, 2400, 900, 100], ...over })

describe('import_garmin_activities', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('dry run previews and saves nothing', async () => {
    const r = await run(importGarminActivities, { activities: [GARMIN()], dry_run: true })
    expect(r).toMatchObject({ saved: false, dry_run: true, would_save: { added: 1, enriched: 0, skipped: 0 } })
    expect(api.puts).toHaveLength(0)
  })

  test('saves, and a second import of the same file changes nothing', async () => {
    const first = await run(importGarminActivities, { activities: [GARMIN(), GARMIN({ id: 1, type: 'strength_training' })] })
    expect(first).toMatchObject({ saved: true, added: 1, skipped: 1 })
    const stored = Object.values(api.doc.activities)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ sport: 'trail', min: 90, km: 12, asc: 700, avgHr: 150, src: 'garmin', gid: '777' })
    const again = await run(importGarminActivities, { activities: [GARMIN()] })
    expect(again).toMatchObject({ saved: true, added: 0, enriched: 0 })
    expect(Object.keys(api.doc.activities)).toHaveLength(1)
  })
})

describe('list_activities and get_run_summary', () => {
  beforeEach(async () => {
    api = await stubApi(DOC())
    await run(importGarminActivities, { activities: [GARMIN(), GARMIN({ id: 778, type: 'running', date: day(-3), start: `${day(-3)} 07:00:00`, km: 8, hours: 0.7, climb_m: 40, zones: null })] })
    _seedStateForTests(structuredClone(api.doc))
  })

  test('lists runs newest first with pace, climb, heart rate and zones', () => {
    const r = listActivities.handler({})
    expect(r.total).toBe(2)
    expect(r.activities[0]).toMatchObject({ sport: 'trail', km: 12, climb_m: 700, avg_hr: 150, hr_zone_seconds: [0, 2000, 2400, 900, 100], pace_sec_per_km: 450, source: 'garmin' })
    expect(r.activities[1].sport).toBe('run')
    expect(listActivities.handler({ sport: 'run' }).activities).toHaveLength(1)
  })

  test('sums the week', () => {
    const r = getRunSummary.handler({ weeks: 2 })
    const total = r.weeks.reduce((s, w) => s + w.runs, 0)
    expect(total).toBe(2)
    expect(r.weeks.reduce((s, w) => s + w.km, 0)).toBeCloseTo(20, 5)
  })
})

describe('log_activity and set_run_plan', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('files a described trail run', async () => {
    const r = await run(logActivity, { date: day(0), sport: 'trail', duration_min: 102, km: 14.2, climb_m: 820, avg_hr: 152, terrain: 'trail' })
    expect(r).toMatchObject({ saved: true, activity: { sport: 'trail', duration_min: 102, km: 14.2, climb_m: 820, avg_hr: 152, source: 'manual' } })
    expect(Object.values(api.doc.activities)[0]).toMatchObject({ sport: 'trail', min: 102, src: 'manual' })
  })

  test('plans a run, shows it in get_week_plan, and clears it', async () => {
    const r = await run(setRunPlan, { date: day(2), kind: 'trail', km: 18, climb_m: 900, note: 'Z2' })
    expect(r).toMatchObject({ saved: true, planned_run: { kind: 'trail', km: 18, asc: 900, note: 'Z2' } })
    _seedStateForTests(structuredClone(api.doc))
    const plan = getWeekPlan.handler({})
    expect(plan.runs).toEqual([expect.objectContaining({ date: day(2), kind: 'trail', status: 'upcoming' })])
    const cleared = await run(setRunPlan, { date: day(2), clear: true })
    expect(cleared).toMatchObject({ saved: true, planned_run: null })
    expect(api.doc.runPlan[day(2)]).toMatchObject({ _ts: expect.any(Number) })
  })

  test('a plan with no kind is a problem, not a save', async () => {
    const r = await run(setRunPlan, { date: day(2) })
    expect(r.saved).toBe(false)
    expect(r.problems).toBeTruthy()
  })
})

describe('what a scoped token may use', () => {
  test('every run tool has a need, and reading needs only view', () => {
    for (const t of ['list_activities', 'get_run_summary', 'log_activity', 'import_garmin_activities', 'set_run_plan']) {
      expect(ALL_TOOLS.some(x => x.name === t)).toBe(true)
      expect(TOOL_NEEDS[t]).toBeTruthy()
    }
    expect(toolAllowed('list_activities', { workouts: 'view' })).toBe(true)
    expect(toolAllowed('import_garmin_activities', { workouts: 'view' })).toBe(false)
    expect(toolAllowed('set_run_plan', { plans: 'apply' })).toBe(true)
    expect(toolAllowed('set_run_plan', { workouts: 'apply' })).toBe(false)
  })
})

const Z = (over = {}) => ({ name: 'Z4', intensity: 'interval', duration_s: 180, hr_min: 165, hr_max: 178, ...over })
const REC = { name: 'Récup', intensity: 'recovery', action: 'walk', duration_s: 120, hr_min: 60, hr_max: 140, climb_margin: true }
const SESSION = { date: day(2), name: 'VO2 6x3', type: 'quality', steps: [
  { name: 'Échauffement', intensity: 'warmup', duration_s: 900, hr_min: 110, hr_max: 135, climb_margin: true },
  { repeat: 6, steps: [Z(), REC] },
  { name: 'Retour', intensity: 'cooldown', duration_s: 600, hr_min: 100, hr_max: 130 },
] }

describe('structured sessions', () => {
  beforeEach(async () => { api = await stubApi(DOC()) })

  test('dry run previews the unrolled steps and totals, and saves nothing', async () => {
    const r = await run(setRunSession, { ...SESSION, dry_run: true })
    expect(r).toMatchObject({ saved: false, dry_run: true, would_save: { session: { name: 'VO2 6x3', type: 'quality', kind: 'run', total_s: 900 + 1800 + 600, min: 55 } } })
    expect(r.would_save.session.steps_flat).toHaveLength(14)
    expect(api.puts).toHaveLength(0)
  })

  test('saves, reads back by get_run_session and shows in get_week_plan', async () => {
    const r = await run(setRunSession, SESSION)
    expect(r.saved).toBe(true)
    expect(api.doc.runPlan[day(2)]).toMatchObject({ kind: 'run', type: 'quality', name: 'VO2 6x3', min: 55 })
    _seedStateForTests(structuredClone(api.doc))
    const got = getRunSession.handler({ date: day(2) })
    expect(got.session).toMatchObject({ name: 'VO2 6x3', status: 'upcoming', total_s: 3300 })
    expect(got.session.steps_flat[1]).toMatchObject({ index: 1, name: 'Z4', block: { n: 1, of: 6 } })
    expect(getRunSession.handler({ date: day(3) }).session).toBe(null)
    expect(getWeekPlan.handler({}).runs[0]).toMatchObject({ name: 'VO2 6x3' })
  })

  test('a trail session plans a trail run', async () => {
    await run(setRunSession, { ...SESSION, type: 'trail' })
    expect(api.doc.runPlan[day(2)].kind).toBe('trail')
  })

  test('what the watch would refuse is refused, with where', async () => {
    const r = await run(setRunSession, { ...SESSION, steps: [{ repeat: 31, steps: [Z(), REC] }] })
    expect(r.saved).toBe(false)
    expect(JSON.stringify(r.problems)).toContain('62 steps')
    const r2 = await run(setRunSession, { ...SESSION, steps: [Z({ hr_min: 0 }), Z({ name: 'x'.repeat(30) })] })
    expect(r2.problems.map(p => p.field)).toEqual(['steps[0]', 'steps[1]'])
    expect(api.puts).toHaveLength(0)
  })

  test('set_run_plan on a date with a session keeps its steps; clear removes it', async () => {
    await run(setRunSession, SESSION)
    await run(setRunPlan, { date: day(2), kind: 'run', km: 9 })
    expect(api.doc.runPlan[day(2)]).toMatchObject({ name: 'VO2 6x3', km: 9 })
    expect(api.doc.runPlan[day(2)].steps).toHaveLength(3)
    await run(setRunSession, { date: day(2), clear: true })
    expect(api.doc.runPlan[day(2)]).toMatchObject({ _ts: expect.any(Number) })
    expect(api.doc.runPlan[day(2)].steps).toBeUndefined()
  })

  test('a run linked to a session counts for it', async () => {
    await run(setRunSession, SESSION)
    await run(importGarminActivities, { activities: [GARMIN({ id: 901 })] })
    const id = Object.keys(api.doc.activities)[0]
    await run(linkActivityToSession, { activity_id: id, session_date: day(2) })
    expect(api.doc.activities[id].sessionDate).toBe(day(2))
    _seedStateForTests(structuredClone(api.doc))
    expect(getRunSession.handler({ date: day(2) }).session.done_by).toEqual([id])
    expect(listActivities.handler({}).activities[0].counts_for_session).toBe(day(2))
    await run(linkActivityToSession, { activity_id: id, session_date: null })
    expect(api.doc.activities[id].sessionDate).toBeUndefined()
    expect((await run(linkActivityToSession, { activity_id: 'nope', session_date: day(2) })).saved).toBe(false)
  })

  test('scopes: reading needs Plans view, writing Plans apply', () => {
    expect(toolAllowed('get_run_session', { plans: 'view' })).toBe(true)
    expect(toolAllowed('set_run_session', { plans: 'view' })).toBe(false)
    expect(toolAllowed('set_run_session', { plans: 'apply' })).toBe(true)
  })
})
