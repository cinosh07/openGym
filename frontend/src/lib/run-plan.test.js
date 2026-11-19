import { describe, it, expect } from 'vitest'
import { readRunPlan, withRunPlan, runPlanBetween, runSummary, addDaysISO } from './run-plan.js'

const acts = {
  a: { d: '2026-11-09', sport: 'run', min: 60, km: 10, terrain: 'road', zones: [600, 2400, 600, 0, 0] },
  b: { d: '2026-11-11', sport: 'trail', min: 120, km: 14, asc: 900, desc: 880, terrain: 'trail', zones: [0, 3000, 3000, 1200, 0], load: 200 },
  c: { d: '2026-11-12', sport: 'ride', min: 90 },
  d: { d: '2026-11-16', sport: 'run', min: 30, km: 5 },
}

describe('planned runs', () => {
  it('reads a clean plan and drops the rest', () => {
    expect(readRunPlan({ kind: 'trail', min: 90.4, km: 12.345, asc: 600, note: ' Z2 ' })).toEqual({ kind: 'trail', min: 90, km: 12.35, asc: 600, note: 'Z2' })
    expect(readRunPlan({ kind: 'swim' })).toBe(null)
    expect(readRunPlan({ _ts: 3 })).toBe(null)
    expect(readRunPlan({ kind: 'run', km: -2, min: 0 })).toEqual({ kind: 'run' })
  })
  it('clearing is a stamped empty entry, so it syncs', () => {
    let m = withRunPlan({}, '2026-11-20', { kind: 'run', km: 8 }, 10)
    expect(m['2026-11-20']).toEqual({ kind: 'run', km: 8, _ts: 10 })
    m = withRunPlan(m, '2026-11-20', null, 20)
    expect(m['2026-11-20']).toEqual({ _ts: 20 })
    expect(runPlanBetween({ runPlan: m }, '2026-11-01', '2026-11-30', '2026-11-18')).toEqual([])
  })
  it('says what became of each: done, today, upcoming, missed', () => {
    const S = { activities: acts, runPlan: {
      '2026-11-11': { kind: 'trail', km: 14 }, '2026-11-13': { kind: 'run', km: 8 },
      '2026-11-18': { kind: 'run', min: 45 }, '2026-11-20': { kind: 'trail', asc: 500 }, '2026-12-01': { kind: 'run' },
    } }
    const out = runPlanBetween(S, '2026-11-09', '2026-11-22', '2026-11-18')
    expect(out.map(p => [p.date, p.status])).toEqual([['2026-11-11', 'done'], ['2026-11-13', 'missed'], ['2026-11-18', 'today'], ['2026-11-20', 'upcoming']])
    expect(out[0].done_by).toEqual(['b'])
  })
  it('a ride does not do a planned run', () => {
    const S = { activities: acts, runPlan: { '2026-11-12': { kind: 'run' } } }
    expect(runPlanBetween(S, '2026-11-12', '2026-11-12', '2026-11-18')[0].status).toBe('missed')
  })
})

describe('a week of running', () => {
  it('adds the runs up and keeps other sport apart', () => {
    const s = runSummary({ activities: acts }, '2026-11-09', '2026-11-15')
    expect(s).toMatchObject({ runs: 2, trail_runs: 1, km: 24, climb_m: 900, descent_m: 880, longest_km: 14, garmin_load: 200 })
    expect(s.hours).toBe(3)
    // zones 1+2: (600+2400) + (0+3000) of 3600 + 7200
    expect(s.easy_pct).toBe(Math.round(100 * 6000 / 10800))
    expect(s.avg_pace_sec_per_km).toBe(Math.round(180 * 60 / 24))
    expect(s.by_terrain).toEqual({ road: 1, trail: 1 })
    expect(s.other_sport).toEqual({ sessions: 1, hours: 1.5 })
  })
  it('has no easy share without zones, and an empty week is zeros', () => {
    expect(runSummary({ activities: acts }, '2026-11-16', '2026-11-22').easy_pct).toBe(null)
    expect(runSummary({}, '2026-11-16', '2026-11-22')).toMatchObject({ runs: 0, km: 0, hours: 0, easy_pct: null, avg_pace_sec_per_km: null })
  })
  it('counts days across a clock change', () => {
    expect(addDaysISO('2026-11-01', 7)).toBe('2026-11-08')
    expect(addDaysISO('2026-03-08', -1)).toBe('2026-03-07')
  })
})
