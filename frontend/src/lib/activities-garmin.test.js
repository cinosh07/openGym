import { describe, it, expect } from 'vitest'
import { readActivity, activityLine, paceOf, fmtPace, activitiesOf, withActivity, activityStimuli } from './activities.js'
import { activityFromGarmin, mergeGarminActivities, sportOfGarminType } from './activities-garmin.js'

const at = (iso, h = 8, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()
const rec = (over = {}) => ({
  id: 22222111, date: '2026-11-14', start: '2026-11-14 08:05:33', type: 'trail_running', name: 'Morin-Heights trail',
  km: 14.2, hours: 1.7, climb_m: 820, descent_m: 810, avg_hr: 152, max_hr: 171, zones: [60, 1500, 3200, 1100, 260], cadence: 168, te: 3.6, te_anaerobic: 1.2, load: 214, ...over,
})

describe('run fields on an activity', () => {
  it('reads the run fields and drops the unusable ones', () => {
    const a = readActivity({ d: '2026-11-14', sport: 'trail', min: 102, km: 14.2, terrain: 'trail', asc: 820, desc: 810.4, avgHr: 152, maxHr: 171, zones: [1, 2, 3, 4, 5], cad: 168, te: 3.64, teAn: 1.2, load: 214, gid: 99 })
    expect(a).toMatchObject({ sport: 'trail', terrain: 'trail', asc: 820, desc: 810, avgHr: 152, maxHr: 171, zones: [1, 2, 3, 4, 5], cad: 168, te: 3.6, teAn: 1.2, load: 214, gid: '99' })
    const bad = readActivity({ d: '2026-11-14', sport: 'run', min: 40, terrain: 'moon', asc: -5, avgHr: 999, maxHr: 'x', zones: [1, 2, 3], cad: 0, te: 9 })
    expect(bad).toEqual({ d: '2026-11-14', sport: 'run', min: 40, src: 'manual' })
  })
  it('an old entry reads exactly as before', () => {
    expect(readActivity({ d: '2026-11-02', sport: 'run', min: 42.4, km: 8.123, src: 'hc' })).toEqual({ d: '2026-11-02', sport: 'run', min: 42, km: 8.12, src: 'hc' })
  })
  it('pace and the line a row shows', () => {
    expect(paceOf({ km: 10, min: 50 })).toBe(300)
    expect(paceOf({ km: 0, min: 50 })).toBe(null)
    expect(fmtPace(305)).toBe('5:05')
    expect(activityLine({ sport: 'trail', min: 102, km: 14.2, asc: 820, avgHr: 152 })).toBe('Trail run · {0} min · 14.2 km · ↑ 820 m · 7:11/km · 152 bpm')
    expect(activityLine({ sport: 'ride', min: 60, km: 25 })).toBe('Ride · {0} min · 25 km')
  })
  it('a trail run loads the quads more than a road run of the same length', () => {
    const S = { activities: { a: { d: '2026-11-14', sport: 'trail', min: 60, at: at('2026-11-14') }, b: { d: '2026-11-14', sport: 'run', min: 60, at: at('2026-11-14') } } }
    const [t, r] = activityStimuli(S, at('2026-11-15'))
    expect(t.sets.quadriceps).toBeGreaterThan(r.sets.quadriceps)
  })
})

describe('Garmin type to sport', () => {
  it('maps runs, trail and skips the gym', () => {
    expect(sportOfGarminType('running')).toEqual({ sport: 'run', terrain: 'road' })
    expect(sportOfGarminType('treadmill_running')).toEqual({ sport: 'run', terrain: 'treadmill' })
    expect(sportOfGarminType('trail_running')).toEqual({ sport: 'trail', terrain: 'trail' })
    expect(sportOfGarminType('hiking')).toEqual({ sport: 'hike' })
    expect(sportOfGarminType('strength_training')).toBe(null)
    expect(sportOfGarminType('walking')).toBe(null)
    expect(sportOfGarminType('something_new', 'Sortie trail du matin')).toEqual({ sport: 'trail', terrain: 'trail' })
  })
})

describe('one collector record', () => {
  it('becomes an activity with every number Garmin gave', () => {
    const a = activityFromGarmin(rec())
    expect(a).toMatchObject({ d: '2026-11-14', sport: 'trail', terrain: 'trail', min: 102, km: 14.2, asc: 820, desc: 810, avgHr: 152, maxHr: 171, cad: 168, te: 3.6, teAn: 1.2, load: 214, gid: '22222111', src: 'garmin', title: 'Morin-Heights trail' })
    expect(a.at).toBe(at('2026-11-14', 8, 5) + 33000)
    expect(a.zones).toEqual([60, 1500, 3200, 1100, 260])
  })
  it('null from Garmin is absent here, never a zero', () => {
    const a = activityFromGarmin(rec({ climb_m: null, avg_hr: null, max_hr: null, zones: null, cadence: null, te: null, te_anaerobic: null, load: null, descent_m: null }))
    expect(a).not.toHaveProperty('asc')
    expect(a).not.toHaveProperty('avgHr')
    expect(a).not.toHaveProperty('zones')
    expect(a).not.toHaveProperty('te')
  })
  it('reads the zones as an object too', () => {
    expect(activityFromGarmin(rec({ zones: { Z1: 1, Z2: 2, Z3: 3, Z4: 4, Z5: 5 } })).zones).toEqual([1, 2, 3, 4, 5])
  })
  it('skips a gym workout, a walk, a very short one and one with no id', () => {
    expect(activityFromGarmin(rec({ type: 'strength_training' }))).toBe(null)
    expect(activityFromGarmin(rec({ type: 'walking' }))).toBe(null)
    expect(activityFromGarmin(rec({ hours: 0.05 }))).toBe(null)
    expect(activityFromGarmin(rec({ id: null }))).toBe(null)
  })
})

describe('importing into the history', () => {
  it('adds new sessions, and importing again changes nothing', () => {
    const S = {}
    const first = mergeGarminActivities(S, [rec(), rec({ id: 22222112, date: '2026-11-15', start: '2026-11-15 07:00:00', type: 'running', km: 8, hours: 0.7 })], { now: 100 })
    expect(first).toMatchObject({ skipped: 0 })
    expect(first.added).toHaveLength(2)
    expect(activitiesOf(S)).toHaveLength(2)
    const before = JSON.stringify(S)
    const again = mergeGarminActivities(S, [rec(), rec({ id: 22222112, date: '2026-11-15', start: '2026-11-15 07:00:00', type: 'running', km: 8, hours: 0.7 })], { now: 200 })
    expect(again).toEqual({ added: [], enriched: [], skipped: 0 })
    expect(JSON.stringify(S)).toBe(before)
  })
  it('never brings back a session removed in openGym', () => {
    const S = {}
    const { added } = mergeGarminActivities(S, [rec()], { now: 100 })
    S.activities = withActivity(S.activities, added[0], null, 150)
    expect(mergeGarminActivities(S, [rec()], { now: 200 })).toEqual({ added: [], enriched: [], skipped: 0 })
    expect(activitiesOf(S)).toEqual([])
  })
  it('counts what it skips', () => {
    const S = {}
    const r = mergeGarminActivities(S, [rec(), rec({ id: 5, type: 'strength_training' })], { now: 1 })
    expect(r.added).toHaveLength(1)
    expect(r.skipped).toBe(1)
  })
  it('enriches a Health Connect run over the same time instead of adding a second', () => {
    const S = { activities: { hc1: { d: '2026-11-14', sport: 'run', min: 100, km: 14, at: at('2026-11-14', 8, 7), src: 'hc', _ts: 5 } } }
    const r = mergeGarminActivities(S, [rec()], { now: 100 })
    expect(r.added).toEqual([])
    expect(r.enriched).toEqual(['hc1'])
    expect(activitiesOf(S)).toHaveLength(1)
    expect(S.activities.hc1).toMatchObject({ sport: 'trail', min: 100, km: 14, src: 'hc', asc: 820, avgHr: 152, gid: '22222111', title: 'Morin-Heights trail', _ts: 100 })
    // a second import finds it by Garmin's id: no new entry, nothing changes
    expect(mergeGarminActivities(S, [rec()], { now: 300 })).toEqual({ added: [], enriched: [], skipped: 0 })
    expect(Object.keys(S.activities)).toEqual(['hc1'])
  })
  it('does not merge a run a long way from the Garmin one', () => {
    const S = { activities: { hc1: { d: '2026-11-14', sport: 'run', min: 40, km: 8, at: at('2026-11-14', 17, 0), src: 'hc', _ts: 5 } } }
    const r = mergeGarminActivities(S, [rec()], { now: 100 })
    expect(r.added).toHaveLength(1)
    expect(activitiesOf(S)).toHaveLength(2)
  })
  it('never overwrites what the user typed on an existing entry', () => {
    const S = { activities: { hc1: { d: '2026-11-14', sport: 'trail', min: 100, km: 14, at: at('2026-11-14', 8, 5), src: 'manual', title: 'Ma sortie', note: 'jambes lourdes', avgHr: 150, _ts: 5 } } }
    mergeGarminActivities(S, [rec()], { now: 100 })
    expect(S.activities.hc1).toMatchObject({ title: 'Ma sortie', note: 'jambes lourdes', avgHr: 150, asc: 820, maxHr: 171 })
  })
})
