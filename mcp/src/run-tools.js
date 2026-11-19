/* Running and trail running: list_activities and get_run_summary read the runs (and other sport) the
   user did, log_activity and import_garmin_activities file them, set_run_plan plans one for a date.
   They save through the openGym api like the plan's tools (routine-tools.js writePlan), with a paired
   session or a scoped token (Workouts at "Change directly" for sessions, Plans for the plan). The
   rules are frontend/src/lib/activities.js, activities-garmin.js and run-plan.js.

   A run is an *activity*, not a workout: no sets, no volume, no records. Distances are in
   kilometres and climbs in metres whatever the profile's weight unit is. */
import crypto from 'node:crypto'
import { z } from 'zod'
import { isoDate, noState, todayIso } from './tools.js'
import { getState } from './state.js'
import { writePlan } from './routine-tools.js'
import { activitiesOf, readActivity, withActivity, SPORTS, TERRAINS, paceOf, isRunSport } from '../../frontend/src/lib/activities.js'
import { mergeGarminActivities } from '../../frontend/src/lib/activities-garmin.js'
import { runSummary, runPlanBetween, withRunPlan, readRunPlan, addDaysISO, PLAN_KINDS } from '../../frontend/src/lib/run-plan.js'

const MAX_IMPORT = 200

// An activity as the tools show it: readable keys, units in the names.
export const activityView = a => ({
  id: a.id, date: a.d, sport: a.sport,
  ...(a.title ? { title: a.title } : {}),
  duration_min: a.min,
  ...(a.km ? { km: a.km } : {}),
  ...(paceOf(a) && isRunSport(a.sport) ? { pace_sec_per_km: paceOf(a) } : {}),
  ...(a.terrain ? { terrain: a.terrain } : {}),
  ...(a.asc != null ? { climb_m: a.asc } : {}),
  ...(a.desc != null ? { descent_m: a.desc } : {}),
  ...(a.avgHr ? { avg_hr: a.avgHr } : {}),
  ...(a.maxHr ? { max_hr: a.maxHr } : {}),
  ...(a.zones ? { hr_zone_seconds: a.zones } : {}),
  ...(a.cad ? { cadence_spm: a.cad } : {}),
  ...(a.te != null ? { training_effect: a.te } : {}),
  ...(a.teAn != null ? { anaerobic_effect: a.teAn } : {}),
  ...(a.load != null ? { load: a.load } : {}),
  ...(a.note ? { note: a.note } : {}),
  ...(a.sessionDate ? { counts_for_session: a.sessionDate } : {}),
  source: a.src,
})

const mondayOf = iso => {
  const d = new Date(iso + 'T12:00:00')
  const back = (d.getDay() + 6) % 7
  return addDaysISO(iso, -back)
}

export const listActivities = {
  name: 'list_activities',
  description: 'List the user\'s runs, trail runs and other sport that is not a gym workout (rides, hikes, swims, football…), newest first: date, sport (run, trail, hike, ride…), duration, km, pace for runs, terrain (road, trail, treadmill, track), climb and descent in metres, average and max heart rate, the seconds spent in each of the five heart-rate zones, cadence, Garmin\'s training effect and load, and where it came from (garmin, hc, ah, import, manual). Distances are km and climbs are metres whatever the profile\'s weight unit. Gym workouts are list_workouts.',
  schema: {
    from: isoDate().optional().describe('Inclusive start date YYYY-MM-DD. Defaults to 28 days before `to`.'),
    to: isoDate().optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.'),
    sport: z.enum(SPORTS).optional().describe('Only this sport. "run" does not include "trail": ask for both for all running.'),
    limit: z.number().int().min(1).max(200).optional().describe('Most sessions to return, 60 by default.'),
  },
  handler: ({ from, to, sport, limit }) => {
    const S = getState()
    if (!S) return noState()
    const hi = to || todayIso()
    const lo = from || addDaysISO(hi, -28)
    const all = activitiesOf(S).filter(a => a.d >= lo && a.d <= hi && (!sport || a.sport === sport))
    const rows = all.slice(0, limit || 60)
    return { from: lo, to: hi, total: all.length, activities: rows.map(activityView) }
  },
}

export const getRunSummary = {
  name: 'get_run_summary',
  description: 'What the runs of a week (or any date range) add up to: number of runs and trail runs, km, hours, climb and descent in metres, longest run, the share of running time spent in heart-rate zones 1 and 2 (`easy_pct`, null when no run has zones), the average pace in seconds per km, Garmin\'s load, the runs by terrain, and the other sport next to it. Give `week_of` (any date in the week, Monday to Sunday) for one week; `weeks` returns that many weeks ending with it, oldest first, for a trend. Without arguments: this week. Also returns the planned runs of the range (set_run_plan) with whether each was done.',
  schema: {
    week_of: isoDate().optional().describe('Any date in the week to summarise (the week runs Monday to Sunday). Defaults to today.'),
    weeks: z.number().int().min(1).max(26).optional().describe('How many weeks, ending with the one above, 1 by default.'),
    from: isoDate().optional().describe('Instead of weeks: inclusive start of a custom range (with `to`).'),
    to: isoDate().optional().describe('Inclusive end of a custom range (with `from`).'),
  },
  handler: ({ week_of, weeks, from, to }) => {
    const S = getState()
    if (!S) return noState()
    const today = todayIso()
    if (from && to) return { range: runSummary(S, from, to), planned: runPlanBetween(S, from, to, today) }
    const monday = mondayOf(week_of || today)
    const n = weeks || 1
    const out = []
    for (let i = n - 1; i >= 0; i--) {
      const a = addDaysISO(monday, -7 * i), b = addDaysISO(a, 6)
      out.push({ ...runSummary(S, a, b), week_starts_on: a, planned: runPlanBetween(S, a, b, today) })
    }
    return n === 1 ? out[0] : { weeks: out }
  },
}

const activityInput = {
  date: isoDate().describe('YYYY-MM-DD, local date of the start.'),
  sport: z.enum(SPORTS).describe('run, trail (trail running), hike, ride…'),
  duration_min: z.number().min(1).max(24 * 60).describe('Moving or elapsed time in minutes.'),
  km: z.number().min(0).max(999).optional().describe('Distance in kilometres.'),
  title: z.string().max(80).optional(),
  terrain: z.enum(TERRAINS).optional().describe('road, trail, treadmill or track (runs).'),
  climb_m: z.number().min(0).max(20000).optional().describe('Total ascent, metres.'),
  descent_m: z.number().min(0).max(20000).optional().describe('Total descent, metres.'),
  avg_hr: z.number().min(30).max(250).optional(),
  max_hr: z.number().min(30).max(250).optional(),
  note: z.string().max(500).optional(),
}

export const logActivity = {
  name: 'log_activity',
  description: 'File a run, trail run or other sport the user describes ("trail 14 km, 820 m of climb, 1 h 42, average heart rate 152"). It is not a gym workout (log_workout is). Nothing here spots a duplicate, so call list_activities first and do not file what is already there (Garmin runs arrive by themselves through import_garmin_activities). Call with dry_run: true first when you had to interpret anything, and save once the user agrees.',
  schema: { ...activityInput, dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.') },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const a = readActivity({
        d: p.date, sport: p.sport, min: p.duration_min, km: p.km, title: p.title, note: p.note, src: 'manual',
        terrain: p.terrain, asc: p.climb_m, desc: p.descent_m, avgHr: p.avg_hr, maxHr: p.max_hr,
      })
      if (!a) return { problems: [{ field: 'date/duration_min', problem: 'a real date (YYYY-MM-DD) and a duration of at least one minute' }] }
      const id = 'mn' + crypto.randomBytes(6).toString('hex')
      S.activities = withActivity(S.activities, id, a)
      return { id, activity: a, what: `activity ${id}` }
    },
    view: (S, out) => ({ activity: activityView({ id: out.id, ...out.activity }) }),
  }),
}

export const importGarminActivities = {
  name: 'import_garmin_activities',
  description: `Import the activities the Garmin collector keeps (activities.json: id, date, start, type, name, km, hours, climb_m, avg_hr, max_hr, zones, and descent_m, cadence, te, te_anaerobic, load when known) into the user's history. Safe to repeat: a session already imported changes nothing, one removed in openGym is never brought back, and a run the phone already read from Health Connect gets the Garmin numbers (heart rate, climb, zones…) added instead of a second entry. Gym workouts and walks are skipped. At most ${MAX_IMPORT} records per call. Use dry_run: true to see what would be added.`,
  schema: {
    activities: z.array(z.record(z.string(), z.any())).min(1).max(MAX_IMPORT).describe('Records as the collector writes them.'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const r = mergeGarminActivities(S, p.activities)
      return { ...r, what: `Garmin import: ${r.added.length} added, ${r.enriched.length} enriched` }
    },
    view: (S, out) => ({ added: out.added.length, enriched: out.enriched.length, skipped: out.skipped, added_ids: out.added.slice(0, 50) }),
  }),
}

export const setRunPlan = {
  name: 'set_run_plan',
  description: 'Plan a run for a date, or clear it: kind "run" or "trail", and any of duration_min, km, climb_m and a note ("sortie longue, Z2, 3 ravitos"). One planned run per date; setting it again replaces it. It shows in get_week_plan (`runs`) and get_run_summary and counts as done when a run or trail run is logged that day. It is not a routine: no sets are logged from it. Read get_week_plan first so you do not overwrite one the user set. Call with dry_run: true first and save once the user agrees.',
  schema: {
    date: isoDate().describe('YYYY-MM-DD, today or later for a new plan.'),
    kind: z.enum(PLAN_KINDS).optional().describe('run or trail. Required unless `clear` is true.'),
    duration_min: z.number().min(1).max(24 * 60).optional(),
    km: z.number().min(0.1).max(999).optional(),
    climb_m: z.number().min(1).max(20000).optional(),
    note: z.string().max(500).optional(),
    clear: z.boolean().optional().describe('Remove the planned run on that date.'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const previous = readRunPlan(S.runPlan?.[p.date])
      if (p.clear) {
        S.runPlan = withRunPlan(S.runPlan, p.date, null)
        return { date: p.date, plan: null, previous, what: `cleared run plan ${p.date}` }
      }
      // A date that already holds a structured session keeps its steps, name and type (set_run_session changes them).
      const plan = readRunPlan({ kind: p.kind, min: p.duration_min, km: p.km, asc: p.climb_m, note: p.note, name: previous?.name, type: previous?.type, steps: previous?.steps })
      if (!plan) return { problems: [{ field: 'kind', problem: 'run or trail' }] }
      S.runPlan = withRunPlan(S.runPlan, p.date, plan)
      return { date: p.date, plan, previous, what: `run plan ${p.date}` }
    },
    view: (S, out) => ({ date: out.date, planned_run: out.plan, previous: out.previous }),
  }),
}

export const RUN_TOOLS = [listActivities, getRunSummary, logActivity, importGarminActivities, setRunPlan]
