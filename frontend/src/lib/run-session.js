// A structured run session: the steps of a workout like "warm up 15 min, 6 × (3 min hard, 2 min easy),
// cool down". It is what the Trail Coach app reads from openGym and sends to the watch, so the rules
// here are the watch's (a message with a step the watch refuses is refused whole):
//
//   step  = { name, intensity, action, duration_s | distance_m, hr_min, hr_max, climb_margin }
//   block = { repeat: 2..50, steps: [step, …] }          (one level: no block inside a block)
//   steps = [step | block, …]                             (at most 60 steps once the blocks are unrolled)
//
//  - name: 1 to 24 characters (it is shown on the watch and read aloud).
//  - intensity: warmup | active | interval | recovery | cooldown. action: run | walk.
//  - duration_s (seconds) OR distance_m (metres), never both.
//  - hr_min and hr_max in bpm, 40 <= hr_min <= hr_max <= 230: the watch refuses anything else.
//  - climb_margin (true/false): Trail Coach's allowance for climbs; only on the easy intensities
//    (warmup, active, recovery, cooldown), never on an interval.
// A leaf module (no imports). api/run-today.js carries a hand-copied unroll for the token endpoint
// (the API image cannot import the frontend); run-session.test.js compares the two.

export const INTENSITIES = ['warmup', 'active', 'interval', 'recovery', 'cooldown']
export const EASY_INTENSITIES = ['warmup', 'active', 'recovery', 'cooldown']
export const ACTIONS = ['run', 'walk']
export const SESSION_TYPES = ['road', 'trail', 'treadmill', 'quality']
export const STEP_NAME_MAX = 24
export const SESSION_NAME_MAX = 60
export const MAX_STEPS = 60
export const REPEAT_MIN = 2
export const REPEAT_MAX = 50
export const HR_MIN_FLOOR = 40
export const HR_MAX_CEIL = 230

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const int = (v, lo, hi) => { const n = Number(v); return v !== '' && v != null && Number.isInteger(n) && n >= lo && n <= hi ? n : null }

// One step, or { problem } (with the path so a caller can say which).
function checkStep(raw, at) {
  const P = problem => ({ problems: [{ field: at, problem }] })
  if (!isMap(raw)) return P('a step is an object')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return P('needs a name')
  if (name.length > STEP_NAME_MAX) return P(`name is ${name.length} characters, at most ${STEP_NAME_MAX} (it is shown on the watch and read aloud)`)
  if (!INTENSITIES.includes(raw.intensity)) return P(`intensity is one of ${INTENSITIES.join(', ')}`)
  const action = raw.action == null ? 'run' : raw.action
  if (!ACTIONS.includes(action)) return P(`action is one of ${ACTIONS.join(', ')}`)
  const hasD = raw.duration_s != null, hasM = raw.distance_m != null
  if (hasD === hasM) return P('give duration_s or distance_m, one of the two and never both')
  const duration_s = hasD ? int(raw.duration_s, 1, 24 * 3600) : null
  const distance_m = hasM ? int(raw.distance_m, 1, 200000) : null
  if (hasD && duration_s == null) return P('duration_s is whole seconds, 1 to 86400')
  if (hasM && distance_m == null) return P('distance_m is whole metres, 1 to 200000')
  const hr_min = int(raw.hr_min, HR_MIN_FLOOR, HR_MAX_CEIL), hr_max = int(raw.hr_max, HR_MIN_FLOOR, HR_MAX_CEIL)
  if (hr_min == null) return P(`hr_min is whole bpm, ${HR_MIN_FLOOR} to ${HR_MAX_CEIL} (the watch refuses less, so there is no "no floor")`)
  if (hr_max == null) return P(`hr_max is whole bpm, ${HR_MIN_FLOOR} to ${HR_MAX_CEIL}`)
  if (hr_min > hr_max) return P('hr_min is above hr_max')
  if (raw.climb_margin != null && typeof raw.climb_margin !== 'boolean') return P('climb_margin is true or false')
  const climb_margin = raw.climb_margin === true
  if (climb_margin && !EASY_INTENSITIES.includes(raw.intensity)) return P('climb_margin is only for easy steps (warmup, active, recovery, cooldown), not an interval')
  return { step: { name, intensity: raw.intensity, action, ...(hasD ? { duration_s } : { distance_m }), hr_min, hr_max, climb_margin } }
}

/**
 * The steps checked and cleaned: → { steps } or { problems: [{ field, problem }] }.
 * Refuses a session that is empty, nests a block, or has more than 60 steps once unrolled.
 */
export function checkSteps(input) {
  if (!Array.isArray(input) || input.length === 0) return { problems: [{ field: 'steps', problem: 'a list of at least one step' }] }
  const out = [], problems = []
  let total = 0
  input.forEach((raw, i) => {
    const at = `steps[${i}]`
    if (isMap(raw) && raw.repeat != null) {
      const repeat = int(raw.repeat, REPEAT_MIN, REPEAT_MAX)
      if (repeat == null) return problems.push({ field: at + '.repeat', problem: `a whole number, ${REPEAT_MIN} to ${REPEAT_MAX}` })
      if (!Array.isArray(raw.steps) || raw.steps.length === 0) return problems.push({ field: at + '.steps', problem: 'a block holds at least one step' })
      const inner = []
      raw.steps.forEach((s, j) => {
        if (isMap(s) && s.repeat != null) return problems.push({ field: `${at}.steps[${j}]`, problem: 'a block inside a block is not allowed' })
        const r = checkStep(s, `${at}.steps[${j}]`)
        if (r.problems) problems.push(...r.problems); else inner.push(r.step)
      })
      total += repeat * inner.length
      out.push({ repeat, steps: inner })
    } else {
      const r = checkStep(raw, at)
      if (r.problems) problems.push(...r.problems); else { out.push(r.step); total++ }
    }
  })
  if (problems.length) return { problems }
  if (total > MAX_STEPS) return { problems: [{ field: 'steps', problem: `${total} steps once the blocks are unrolled; the watch takes ${MAX_STEPS} at most` }] }
  return { steps: out }
}

/**
 * The steps unrolled for the watch: one flat list, each step numbered from 0, with `block`
 * ({ n, of }: this is round n of `of`) when it comes from a block, else null. Assumes checked steps.
 */
export function unrollSteps(steps) {
  const flat = []
  for (const item of Array.isArray(steps) ? steps : []) {
    if (item && item.repeat) {
      for (let n = 1; n <= item.repeat; n++) for (const s of item.steps) flat.push({ ...s, block: { n, of: item.repeat } })
    } else if (item) flat.push({ ...item, block: null })
  }
  return flat.map((s, index) => ({ index, ...s }))
}

/** { total_s, total_m } of unrolled steps (a step by distance adds to metres only). */
export function totalsOf(flat) {
  let s = 0, m = 0
  for (const x of flat) { s += x.duration_s || 0; m += x.distance_m || 0 }
  return { total_s: s, total_m: m }
}

export const readSteps = input => { const r = checkSteps(input); return r.steps || null }
