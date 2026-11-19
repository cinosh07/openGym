// Running in the plan and in the week: what is planned for a date (a run or a trail run, how long,
// how far, how much climb) and what the week of runs adds up to. Pure and beside its test, like
// lib/activities.js, whose sessions it reads.
//
//   S.runPlan = { '2026-11-21': { kind: 'run' | 'trail', min?, km?, asc?, note?, name?, type?, steps?, _ts }, … }
//
// `steps` (with `name` and `type`) makes it a structured session, the steps a watch runs: lib/run-session.js.
//
// One planned run per date. It is a stamped map like S.activities: setting a date again replaces
// it, and clearing one is a stamped empty entry, so the removal syncs and stays gone. A planned run
// is not a workout and not a routine: nothing is logged from it. It is done when a run or a trail
// run is logged on its date (an activity, from Garmin, the health store or by hand).
import { activitiesOf, isRunSport, paceOf } from './activities.js'
import { NOTE_MAX } from './history.js'
import { readSteps, unrollSteps, totalsOf, SESSION_TYPES, SESSION_NAME_MAX } from './run-session.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const PLAN_KINDS = ['run', 'trail']
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d
const pos = (v, max) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= max ? n : null }

/** One stored entry read back: { kind, min?, km?, asc?, note? } or null for a cleared or broken one. */
export function readRunPlan(entry) {
  if (!isMap(entry)) return null
  const kind = PLAN_KINDS.includes(entry.kind) ? entry.kind : null
  if (!kind) return null
  const min = pos(entry.min, 24 * 60), km = pos(entry.km, 1000), asc = pos(entry.asc, 20000)
  const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, NOTE_MAX) : ''
  const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, SESSION_NAME_MAX) : ''
  const type = SESSION_TYPES.includes(entry.type) ? entry.type : null
  const steps = entry.steps != null ? readSteps(entry.steps) : null
  return {
    kind,
    ...(min ? { min: Math.round(min) } : {}),
    ...(km ? { km: round(km, 2) } : {}),
    ...(asc ? { asc: Math.round(asc) } : {}),
    ...(note ? { note } : {}),
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
    ...(steps ? { steps } : {}),
  }
}

/** S.runPlan with `iso` set to `plan` (or cleared with null), stamped `now`. */
export function withRunPlan(map, iso, plan, now = Date.now()) {
  const clean = plan ? readRunPlan(plan) : null
  return { ...(isMap(map) ? map : {}), [iso]: clean ? { ...clean, _ts: now } : { _ts: now } }
}

/**
 * The planned runs from `from` to `to` (inclusive), each with how it stands on `today`:
 * 'done' (a run or trail run is logged that day), 'today', 'missed' (a past date with none) or
 * 'upcoming'. `done_by` names the sessions that did it.
 */
export function runPlanBetween(S, from, to, today) {
  const map = isMap(S?.runPlan) ? S.runPlan : {}
  const acts = activitiesOf(S).filter(a => isRunSport(a.sport))
  const out = []
  for (const iso of Object.keys(map).sort()) {
    if (!ISO.test(iso) || iso < from || iso > to) continue
    const plan = readRunPlan(map[iso])
    if (!plan) continue
    // A run is the day's session by its own date, or by the date it was explicitly linked to
    // (`sessionDate`, for a second run the same day).
    const done = acts.filter(a => (a.sessionDate || a.d) === iso)
    const status = done.length ? 'done' : iso === today ? 'today' : iso < today ? 'missed' : 'upcoming'
    out.push({ date: iso, ...plan, status, ...(done.length ? { done_by: done.map(a => a.id) } : {}) })
  }
  return out
}

/**
 * A planned session as the tools show it: the stored plan, where it stands on `today`, and, for a
 * structured one, its steps unrolled for the watch (`steps_flat`) with the totals. Null when none.
 */
export function sessionView(S, iso, today) {
  const plan = readRunPlan(isMap(S?.runPlan) ? S.runPlan[iso] : null)
  if (!plan) return null
  const [p] = runPlanBetween(S, iso, iso, today)
  const flat = plan.steps ? unrollSteps(plan.steps) : null
  return { date: iso, ...plan, status: p?.status, ...(p?.done_by ? { done_by: p.done_by } : {}), ...(flat ? { steps_flat: flat, ...totalsOf(flat) } : {}) }
}

/** The ISO date `n` days after `iso`, at noon so a daylight-saving jump cannot move it. */
export function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/**
 * What the runs from `from` to `to` add up to: sessions, kilometres, hours, climb and descent, the
 * longest run, the share of time in zones 1 and 2 over the runs whose zones are known (`easy_pct`,
 * null when none are), the average pace and Garmin's load; and, apart, the other sport.
 */
export function runSummary(S, from, to) {
  const runs = activitiesOf(S).filter(a => isRunSport(a.sport) && a.d >= from && a.d <= to)
  const other = activitiesOf(S).filter(a => !isRunSport(a.sport) && a.d >= from && a.d <= to)
  let km = 0, min = 0, asc = 0, desc = 0, load = 0, longest = 0, zoneAll = 0, zoneEasy = 0, trailN = 0
  const terrain = {}
  for (const a of runs) {
    km += a.km || 0; min += a.min; asc += a.asc || 0; desc += a.desc || 0; load += a.load || 0
    longest = Math.max(longest, a.km || 0)
    if (a.sport === 'trail') trailN++
    const t = a.terrain || (a.sport === 'trail' ? 'trail' : 'unknown')
    terrain[t] = (terrain[t] || 0) + 1
    if (a.zones) {
      const total = a.zones.reduce((s, v) => s + v, 0)
      zoneAll += total; zoneEasy += a.zones[0] + a.zones[1]
    }
  }
  const withKm = runs.filter(a => a.km > 0)
  const pace = withKm.length ? paceOf({ km: withKm.reduce((s, a) => s + a.km, 0), min: withKm.reduce((s, a) => s + a.min, 0) }) : null
  return {
    from, to,
    runs: runs.length, trail_runs: trailN,
    km: round(km, 1), hours: round(min / 60, 2), climb_m: asc, descent_m: desc,
    longest_km: round(longest, 1),
    easy_pct: zoneAll > 0 ? Math.round(100 * zoneEasy / zoneAll) : null,
    avg_pace_sec_per_km: pace,
    garmin_load: load || null,
    by_terrain: terrain,
    other_sport: { sessions: other.length, hours: round(other.reduce((s, a) => s + a.min, 0) / 60, 2) },
  }
}
