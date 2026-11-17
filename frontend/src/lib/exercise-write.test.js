// create_exercise's rules (lib/exercise-write.js): what it stores, and what it refuses.
import { describe, expect, it } from 'vitest'
import { createExercise, DEFAULT_EQUIPMENT } from './exercise-write.js'
import { resolveExercise } from './log-workout.js'
import { MUSCLE_MODEL } from './muscles.js'

const doc = (over = {}) => ({ unit: 'lb', customEx: [], routines: [], workouts: [], ...over })

describe('createExercise', () => {
  it('stores what the Create-your-own-exercise sheet stores', () => {
    const S = doc()
    const r = createExercise(S, { name: '  Wall   angel  ', bodyPart: 'shoulders', primary: ['rear-delts', 'upper-back'], secondary: ['serratus', 'rear-delts'], description: 'Slow, back flat on the wall' }, { id: 'c1' })
    expect(r.problems).toBeUndefined()
    expect(r.exercise).toEqual({
      id: 'c1', n: 'Wall angel', bp: 'shoulders', desc: 'Slow, back flat on the wall',
      tg: 'rear-delts', sm: ['serratus'], muscleGroups: ['rear-delts', 'upper-back', 'serratus'], primaries: ['rear-delts', 'upper-back'], secondaries: ['serratus'],
      eq: DEFAULT_EQUIPMENT, custom: true, mv: MUSCLE_MODEL, aliases: [],
    })
    expect(S.customEx).toEqual([r.exercise])
  })

  it('needs no muscles: the target is then empty, like the sheet\'s "No explicit muscle group"', () => {
    const S = doc()
    const { exercise } = createExercise(S, { name: 'Balance hold', bodyPart: 'lower legs' })
    expect(exercise).toMatchObject({ tg: '', primaries: [], secondaries: [], muscleGroups: [], eq: 'body weight' })
    expect(exercise.id).toMatch(/^c/)
  })

  it('a cardio exercise\'s only primary is the heart', () => {
    const { exercise } = createExercise(doc(), { name: 'Stair climb', bodyPart: 'cardio', equipment: 'Body Weight', primary: ['calves'] })
    expect(exercise).toMatchObject({ primaries: ['cardiovascular system'], tg: '', eq: 'body weight' })
  })

  it('is found afterwards by name and by id, like any of your exercises', () => {
    const S = doc()
    const { exercise } = createExercise(S, { name: 'Balance hold', bodyPart: 'lower legs' }, { id: 'c9' })
    expect(resolveExercise(S, 'balance hold')).toMatchObject({ id: 'c9', custom: true })
    expect(resolveExercise(S, exercise.id)).toMatchObject({ name: 'Balance hold' })
  })

  it('refuses a name the library or your own list already has, naming it', () => {
    const S = doc({ customEx: [{ id: 'c1', n: 'Balance hold', bp: 'lower legs', eq: 'body weight', custom: true }] })
    const mine = createExercise(S, { name: 'BALANCE  hold', bodyPart: 'lower legs' })
    expect(mine.problems[0]).toMatchObject({ field: 'name', candidates: [{ id: 'c1', name: 'Balance hold' }] })
    const catalogue = createExercise(S, { name: 'Side Plank', bodyPart: 'waist' })
    expect(catalogue.problems[0].candidates[0].name).toBe('side plank')
    expect(S.customEx).toHaveLength(1)
  })

  it('says every problem at once and leaves the document alone', () => {
    const S = doc()
    const before = JSON.stringify(S)
    const r = createExercise(S, { name: '', bodyPart: 'toes', equipment: 'jetpack', primary: ['wings'], secondary: 'calves' })
    expect(r.problems.map(p => p.field).sort()).toEqual(['bodyPart', 'equipment', 'name', 'primary', 'secondary'])
    expect(JSON.stringify(S)).toBe(before)
  })

  it('cuts a long name and a long description to what the sheet takes', () => {
    const { exercise } = createExercise(doc(), { name: 'x'.repeat(200), bodyPart: 'waist', description: 'd'.repeat(2000) })
    expect(exercise.n).toHaveLength(80)
    expect(exercise.desc).toHaveLength(1000)
  })
})
