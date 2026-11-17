/* create_exercise: the user's own exercise, for the one a routine or a workout needs and the
   library does not have (a balance hold, a physio drill). It saves through the openGym api like the
   plan's tools (routine-tools.js writePlan), with a paired session or a scoped token that holds
   Plans or Workouts at "Change directly": the profile's own exercises (customEx) belong to both.
   The rules are frontend/src/lib/exercise-write.js, which stores what the app's own sheet stores. */
import { z } from 'zod'
import { writePlan } from './routine-tools.js'
import { createExercise, EXERCISE_LIMITS } from '../../frontend/src/lib/exercise-write.js'
import { BODY_PARTS } from '../../frontend/src/lib/log-workout.js'
import { MUSCLES } from '../../frontend/src/lib/muscles.js'

// The exercise as search_exercises lists it, plus what was stored on top.
const view = ex => ({
  exercise: {
    id: ex.id, name: ex.n, body_part: ex.bp, target: ex.tg || null, equipment: ex.eq, category: 'own exercise',
    ...(ex.primaries?.length ? { primary_muscles: ex.primaries } : {}),
    ...(ex.secondaries?.length ? { secondary_muscles: ex.secondaries } : {}),
    ...(ex.desc ? { description: ex.desc } : {}),
  },
})

export const createExerciseTool = {
  name: 'create_exercise',
  description: [
    'Create an exercise of the user\'s own, for one the library does not have. Search first (search_exercises, try two or three phrasings: the library has over 5,000 entries) and use the id you find; only create one after the user agrees none fits.',
    'It is stored like an exercise made in the app (Library → Create your own), so it can go in routines and workouts by name or by the id this returns, and the user can edit it later.',
    'Needs a name and a body part; equipment defaults to body weight. A hold (plank, balance) is no different here: give it seconds, not reps, when you put it in a routine (create_routine, update_routine).',
    'A name the library or the user already has is refused with that exercise as a candidate. Call with dry_run: true first, show the user what will be created, and save once they agree.',
  ].join(' '),
  schema: {
    name: z.string().min(1).max(EXERCISE_LIMITS.maxName).describe('The exercise\'s name, as the user would say it ("Single leg balance hold").'),
    body_part: z.enum(BODY_PARTS).describe('Where it works: back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs or waist.'),
    equipment: z.string().max(40).optional().describe('What it needs, as search_exercises spells it ("body weight", "dumbbell", "band", "cable"…). Defaults to "body weight".'),
    primary_muscles: z.array(z.enum(MUSCLES)).max(MUSCLES.length).optional().describe('The muscles it mainly works. The first one is the exercise\'s target. Omit when unsure.'),
    secondary_muscles: z.array(z.enum(MUSCLES)).max(MUSCLES.length).optional().describe('Muscles that help.'),
    description: z.string().max(EXERCISE_LIMITS.maxDesc).optional().describe('Set-up and cues, shown with the exercise.'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const r = createExercise(S, { name: p.name, bodyPart: p.body_part, equipment: p.equipment, primary: p.primary_muscles, secondary: p.secondary_muscles, description: p.description })
      return r.problems ? r : { ...r, what: `new exercise ${r.exercise.id}` }
    },
    view: (S, out) => view(out.exercise),
  }),
}

export const EXERCISE_TOOLS = [createExerciseTool]
