import { describe, it, expect } from 'vitest'
import { checkSteps, unrollSteps, totalsOf, readSteps, MAX_STEPS } from './run-session.js'
import { readRunPlan, withRunPlan, sessionView, runPlanBetween } from './run-plan.js'
import { unrollSteps as apiUnroll, totalsOf as apiTotals, runToday } from '../../../api/run-today.js'

const warm = { name: 'Échauffement', intensity: 'warmup', action: 'run', duration_s: 900, hr_min: 110, hr_max: 135, climb_margin: true }
const hard = { name: 'Z4', intensity: 'interval', action: 'run', duration_s: 180, hr_min: 165, hr_max: 178, climb_margin: false }
const rec = { name: 'Récup', intensity: 'recovery', action: 'walk', duration_s: 120, hr_min: 60, hr_max: 140, climb_margin: true }
const cool = { name: 'Retour au calme', intensity: 'cooldown', distance_m: 1000, hr_min: 110, hr_max: 135 }
const SESSION = [warm, { repeat: 6, steps: [hard, rec] }, cool]

describe('checking the steps (the watch\'s rules)', () => {
  it('takes a good session and fills in the defaults', () => {
    const r = checkSteps(SESSION)
    expect(r.problems).toBeUndefined()
    expect(r.steps[2]).toEqual({ ...cool, action: 'run', climb_margin: false })
  })
  const bad = (step, text) => {
    const r = checkSteps([step])
    expect(r.problems?.[0]?.problem, text).toMatch(text)
  }
  it('refuses what the watch would refuse', () => {
    bad({ ...warm, hr_min: 0 }, /hr_min is whole bpm, 40/)
    bad({ ...warm, hr_min: 39 }, /hr_min/)
    bad({ ...warm, hr_min: 140 }, /above hr_max/)
    bad({ ...warm, hr_max: 231 }, /hr_max/)
    bad({ ...warm, name: 'x'.repeat(25) }, /24/)
    bad({ ...warm, name: '  ' }, /name/)
    bad({ ...warm, distance_m: 500 }, /never both/)
    bad({ name: 'a', intensity: 'warmup', hr_min: 100, hr_max: 120 }, /duration_s or distance_m/)
    bad({ ...warm, intensity: 'rest' }, /intensity/)
    bad({ ...warm, action: 'crawl' }, /action/)
    bad({ ...warm, duration_s: 0 }, /whole seconds/)
    bad({ ...hard, climb_margin: true }, /only for easy/)
  })
  it('refuses a bad block, a nested block, an empty list and too many steps', () => {
    expect(checkSteps([{ repeat: 1, steps: [hard] }]).problems[0].field).toBe('steps[0].repeat')
    expect(checkSteps([{ repeat: 51, steps: [hard] }]).problems[0].field).toBe('steps[0].repeat')
    expect(checkSteps([{ repeat: 2, steps: [{ repeat: 2, steps: [hard] }] }]).problems[0].problem).toMatch(/inside a block/)
    expect(checkSteps([]).problems).toBeTruthy()
    expect(checkSteps([{ repeat: 2, steps: [] }]).problems[0].problem).toMatch(/at least one/)
    const r = checkSteps([{ repeat: 31, steps: [hard, rec] }])
    expect(r.problems[0].problem).toContain('62 steps')
    expect(checkSteps([{ repeat: 30, steps: [hard, rec] }]).steps).toBeTruthy()
    expect(MAX_STEPS).toBe(60)
  })
  it('names every problem with where it is', () => {
    const r = checkSteps([warm, { repeat: 3, steps: [hard, { ...rec, hr_min: 10 }] }])
    expect(r.problems).toEqual([expect.objectContaining({ field: 'steps[1].steps[1]' })])
  })
})

describe('unrolling for the watch', () => {
  const steps = checkSteps(SESSION).steps
  it('numbers the steps and says which round of a block each is', () => {
    const flat = unrollSteps(steps)
    expect(flat).toHaveLength(14)
    expect(flat[0]).toMatchObject({ index: 0, name: 'Échauffement', block: null })
    expect(flat[1]).toMatchObject({ index: 1, name: 'Z4', block: { n: 1, of: 6 } })
    expect(flat[2]).toMatchObject({ index: 2, name: 'Récup', block: { n: 1, of: 6 } })
    expect(flat[12]).toMatchObject({ name: 'Récup', block: { n: 6, of: 6 } })
    expect(flat[13]).toMatchObject({ index: 13, name: 'Retour au calme', distance_m: 1000, block: null })
    expect(totalsOf(flat)).toEqual({ total_s: 900 + 6 * 300, total_m: 1000 })
  })
  it('the API\'s hand copy gives the same list', () => {
    expect(apiUnroll(steps)).toEqual(unrollSteps(steps))
    expect(apiTotals(unrollSteps(steps))).toEqual(totalsOf(unrollSteps(steps)))
  })
})

describe('a structured session in the plan', () => {
  const S = () => ({
    runPlan: withRunPlan({}, '2026-11-20', { kind: 'run', type: 'quality', name: 'VO2 6x3', steps: SESSION, min: 45 }, 5),
    activities: {},
  })
  it('keeps its name, type and steps; a plain plan has none', () => {
    const p = readRunPlan(S().runPlan['2026-11-20'])
    expect(p).toMatchObject({ kind: 'run', type: 'quality', name: 'VO2 6x3', min: 45 })
    expect(p.steps).toHaveLength(3)
    expect(readRunPlan({ kind: 'run', km: 5, steps: [{ ...warm, hr_min: 0 }] })).toEqual({ kind: 'run', km: 5 })
  })
  it('session view: unrolled, with totals and its status', () => {
    const v = sessionView(S(), '2026-11-20', '2026-11-20')
    expect(v).toMatchObject({ status: 'today', total_s: 2700, total_m: 1000 })
    expect(v.steps_flat).toHaveLength(14)
    expect(sessionView(S(), '2026-11-21', '2026-11-20')).toBe(null)
  })
  it('a run counts for the day\'s session, or for the one it is linked to', () => {
    const s = S()
    s.activities = {
      a: { d: '2026-11-20', sport: 'run', min: 40, km: 7 },
      b: { d: '2026-11-21', sport: 'run', min: 30, km: 5, sessionDate: '2026-11-20' },
      c: { d: '2026-11-20', sport: 'run', min: 20, km: 3, sessionDate: '2026-11-19' },
    }
    expect(runPlanBetween(s, '2026-11-20', '2026-11-20', '2026-11-22')[0].done_by.sort()).toEqual(['a', 'b'])
  })
})

describe('the token endpoint\'s session', () => {
  const state = { runPlan: { '2026-11-20': { kind: 'run', type: 'quality', name: 'VO2', steps: checkSteps(SESSION).steps, min: 45, _ts: 1 } }, activities: { a: { d: '2026-11-20', sport: 'trail', min: 50 } } }
  it('flattens the day and says whether it is done', () => {
    const r = runToday(state, '2026-11-20')
    expect(r.session).toMatchObject({ name: 'VO2', type: 'quality', kind: 'run', done: true, total_s: 2700, total_m: 1000, min: 45 })
    expect(r.session.steps).toHaveLength(14)
    expect(r.session.steps[1]).toMatchObject({ index: 1, block: { n: 1, of: 6 }, hr_min: 165, hr_max: 178, climb_margin: false })
  })
  it('null when nothing is planned or the plan was cleared; no steps for a plain run', () => {
    expect(runToday(state, '2026-11-21')).toEqual({ date: '2026-11-21', session: null })
    expect(runToday({ runPlan: { '2026-11-21': { _ts: 3 } } }, '2026-11-21').session).toBe(null)
    expect(runToday({ runPlan: { 'd': { kind: 'run', km: 5 } } }, 'd').session).toMatchObject({ steps: [], total_s: 0, done: false, km: 5 })
  })
  it('readSteps is the same check', () => {
    expect(readSteps(SESSION)).toEqual(checkSteps(SESSION).steps)
    expect(readSteps([{ ...warm, hr_min: 1 }])).toBe(null)
  })
})
