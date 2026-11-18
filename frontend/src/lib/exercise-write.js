// An exercise of your own described rather than built in the sheet ("wall angels, upper back, body
// weight"), for the MCP server's create_exercise tool. Pure and beside its test, like
// routine-write.js, because it decides what lands in S.customEx.
//
// It stores what the Create-your-own-exercise sheet (sheets.jsx CustomExForm) stores, field for
// field, so an exercise made here edits, merges and syncs like one made on the phone. A name that
// the library already has (the catalogue's or one of yours, any case) is not made twice: it comes
// back as a problem naming the existing exercise, so the caller uses that one instead.
import { BODY_PARTS } from './log-workout.js'
import { ALL_EQUIPMENT } from './equipment.js'
import { MUSCLES, MUSCLE_MODEL, inMuscleOrder } from './muscles.js'
import { allExercises } from './exercises.js'
import { normalizeAliases } from './exercise-aliases.js'
import { uid } from './format.js'

export const EXERCISE_LIMITS = { maxName: 80, maxDesc: 1000 }
export const DEFAULT_EQUIPMENT = 'body weight'

const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '')
const nameKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Adds your own exercise to S.customEx.
 * input: { name, bodyPart, equipment?, primary?: [muscle], secondary?: [muscle], description?, aliases?: [text] }
 * Returns { exercise } (S changed) or { problems: [{ field, problem, candidates? }] } (S untouched).
 * `id` is only for tests; the app's own ids are 'c' + a time-based uid.
 */
export function createExercise(S, input, { id } = {}) {
  const problems = []
  const name = clean(input?.name, EXERCISE_LIMITS.maxName)
  if (!name) problems.push({ field: 'name', problem: 'give it a name' })
  const bp = input?.bodyPart
  if (!BODY_PARTS.includes(bp)) problems.push({ field: 'bodyPart', problem: `one of ${BODY_PARTS.join(', ')}` })
  const eq = input?.equipment == null || input.equipment === '' ? DEFAULT_EQUIPMENT : String(input.equipment).trim().toLowerCase()
  if (!ALL_EQUIPMENT.includes(eq)) problems.push({ field: 'equipment', problem: `not an equipment the library knows; one of ${ALL_EQUIPMENT.join(', ')}` })
  const muscles = (field, list) => {
    if (list == null) return []
    if (!Array.isArray(list)) { problems.push({ field, problem: 'a list of muscles' }); return [] }
    const bad = list.filter(m => !MUSCLES.includes(m))
    if (bad.length) problems.push({ field, problem: `unknown muscle ${bad.map(b => JSON.stringify(String(b))).join(', ')}; use ${MUSCLES.join(', ')}` })
    return list.filter(m => MUSCLES.includes(m))
  }
  const primaries = muscles('primary', input?.primary)
  const secondaries = muscles('secondary', input?.secondary)
  const desc = clean(input?.description, EXERCISE_LIMITS.maxDesc)
  if (name) {
    const dup = allExercises(S).find(e => nameKey(e.n) === nameKey(name))
    if (dup) problems.push({ field: 'name', problem: `“${dup.n}” already exists: use it instead of making a second one`, candidates: [{ id: dup.id, name: dup.n, equipment: dup.eq || null, bodyPart: dup.bp || null }] })
  }
  if (problems.length) return { problems }

  // The sheet stores the muscles in the map's order, and the one-word target is the first
  // primary named. A cardio exercise has no muscle chips: its only primary is the heart.
  const prim = bp === 'cardio' ? ['cardiovascular system'] : inMuscleOrder(primaries)
  const sm = inMuscleOrder(secondaries.filter(m => !prim.includes(m)))
  const tg = bp === 'cardio' ? '' : (primaries.find(m => prim.includes(m)) || prim[0] || '')
  const c = { id: id || 'c' + uid(), n: name, bp, desc, tg, sm, muscleGroups: [...prim, ...sm], primaries: prim, secondaries: sm, eq, custom: true, mv: MUSCLE_MODEL }
  const aliases = normalizeAliases(input?.aliases)
  c.aliases = aliases
  S.customEx = Array.isArray(S.customEx) ? S.customEx : []
  S.customEx.push(c)
  return { exercise: c }
}
