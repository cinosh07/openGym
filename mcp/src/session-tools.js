/* Structured run sessions: get_run_session reads the session planned for a date, set_run_session
   creates or replaces it (named steps with heart-rate targets and repeated blocks), and
   link_activity_to_session says which planned session a logged run counts for. The Trail Coach app
   reads the same thing from the profile (GET /api/token/run/today) and sends it to the watch, so the
   rules are the watch's and live in frontend/src/lib/run-session.js. They save through the openGym
   api like the other plan tools (routine-tools.js writePlan). */
import { z } from 'zod'
import { isoDate, noState, todayIso } from './tools.js'
import { getState } from './state.js'
import { writePlan } from './routine-tools.js'
import { readActivity, withActivity } from '../../frontend/src/lib/activities.js'
import { readRunPlan, withRunPlan, sessionView } from '../../frontend/src/lib/run-plan.js'
import { checkSteps, unrollSteps, totalsOf, SESSION_TYPES, STEP_NAME_MAX, MAX_STEPS } from '../../frontend/src/lib/run-session.js'

const stepSchema = z.any().describe(`A step { name (1 to ${STEP_NAME_MAX} characters), intensity (warmup | active | interval | recovery | cooldown), action (run | walk, default run), duration_s OR distance_m (never both), hr_min and hr_max (bpm, 40 to 230, hr_min <= hr_max), climb_margin (true/false, only on easy steps, never an interval) } or a block { repeat (2 to 50), steps: [step, ...] } (one level, no block inside a block).`)

export const getRunSession = {
  name: 'get_run_session',
  description: 'Read the structured run session planned for a date (today by default): its name, type (road, trail, treadmill, quality), the steps as stored (blocks with a repeat count) and unrolled one by one for the watch (steps_flat, each with its index and, inside a block, which round), totals in seconds and metres, where it stands (today, upcoming, done, missed) and the runs that did it. `session` is null when nothing is planned. The Trail Coach app reads the same thing from the profile and sends it to the watch.',
  schema: { date: isoDate().optional().describe('YYYY-MM-DD. Defaults to today.') },
  handler: ({ date }) => {
    const S = getState()
    if (!S) return noState()
    const today = todayIso()
    const iso = date || today
    return { date: iso, session: sessionView(S, iso, today) }
  },
}

export const setRunSession = {
  name: 'set_run_session',
  description: `Create or replace the structured run session for a date: a name, a type (road, trail, treadmill, quality) and an ordered list of steps, with repeated blocks ("6 x (3 min Z4, 2 min recovery)"). One session per date; it replaces what that date held (a plain planned run too). The steps follow the watch's rules and anything it would refuse is refused here: step names of ${STEP_NAME_MAX} characters at most, hr_min of at least 40, at most ${MAX_STEPS} steps once the blocks are unrolled, climb_margin only on easy steps. Read get_run_session first so you do not overwrite one the user made in Trail Coach. Call with dry_run: true first, show the steps and the totals, and save once the user agrees. clear: true removes the date's session.`,
  schema: {
    date: isoDate().describe('YYYY-MM-DD.'),
    name: z.string().min(1).max(60).optional().describe('The session\'s name ("VO2 6x3 min"). Required unless clear.'),
    type: z.enum(SESSION_TYPES).optional().describe('road, trail, treadmill or quality. Required unless clear.'),
    steps: z.array(stepSchema).max(200).optional().describe('The ordered steps and blocks. Required unless clear.'),
    note: z.string().max(500).optional(),
    clear: z.boolean().optional().describe('Remove the session on that date.'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const previous = readRunPlan(S.runPlan?.[p.date])
      if (p.clear) {
        S.runPlan = withRunPlan(S.runPlan, p.date, null)
        return { date: p.date, plan: null, previous, what: `cleared run session ${p.date}` }
      }
      const problems = []
      if (!p.name || !p.name.trim()) problems.push({ field: 'name', problem: 'the session needs a name' })
      if (!SESSION_TYPES.includes(p.type)) problems.push({ field: 'type', problem: `one of ${SESSION_TYPES.join(', ')}` })
      const checked = checkSteps(p.steps)
      if (checked.problems) problems.push(...checked.problems)
      if (problems.length) return { problems }
      const flat = unrollSteps(checked.steps)
      const totals = totalsOf(flat)
      const timed = totals.total_s > 0 && totals.total_m === 0
      const measured = totals.total_m > 0 && totals.total_s === 0
      const plan = readRunPlan({
        kind: p.type === 'trail' ? 'trail' : 'run', name: p.name, type: p.type, steps: checked.steps, note: p.note,
        ...(timed ? { min: Math.max(1, Math.round(totals.total_s / 60)) } : {}),
        ...(measured ? { km: totals.total_m / 1000 } : {}),
      })
      S.runPlan = withRunPlan(S.runPlan, p.date, plan)
      return { date: p.date, plan, previous, flat, totals, what: `run session ${p.date}` }
    },
    view: (S, out) => ({ date: out.date, session: out.plan ? { ...out.plan, steps_flat: out.flat, ...out.totals } : null, previous: out.previous }),
  }),
}

export const linkActivityToSession = {
  name: 'link_activity_to_session',
  description: 'Say which planned session a logged run counts for, when it is not the one of its own day (two runs the same day, or a session done a day late). By default a run or trail run counts for the session planned on its date; this sets the date it counts for instead. session_date null removes the link.',
  schema: {
    activity_id: z.string().min(1).max(60).describe('The id from list_activities.'),
    session_date: isoDate().nullable().describe('YYYY-MM-DD of the planned session, or null to unlink.'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const cur = readActivity(S.activities?.[p.activity_id])
      if (!cur) return { problems: [{ field: 'activity_id', problem: 'no such activity (list_activities has the ids)' }] }
      const { sessionDate, ...rest } = cur
      S.activities = withActivity(S.activities, p.activity_id, p.session_date ? { ...rest, sessionDate: p.session_date } : rest)
      return { id: p.activity_id, date: p.session_date, what: `activity ${p.activity_id} linked to ${p.session_date}` }
    },
    view: (S, out) => ({ activity_id: out.id, counts_for_session: out.date }),
  }),
}

export const SESSION_TOOLS = [getRunSession, setRunSession, linkActivityToSession]
