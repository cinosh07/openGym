// Notes written rather than typed in the app, for the MCP server's set_exercise_note and
// set_day_note tools. Pure and beside its test, like routine-write.js and exercise-write.js.
//
// Two kinds, stored the way the app stores them:
//  - a standing note on an exercise: S.exNotes[exerciseId] = 'text' (lib/history.js exNoteFor),
//    shown with the exercise in every workout. The sync stamps it per key like any other edit.
//  - a note on a day: S.dayNotes[iso] = { tag?, text?, _ts } (lib/day-notes.js), written with that
//    file's own helper so a removal is a stamped empty entry and syncs.
// Nothing here guesses: an exercise that is not exactly one in the library, a note longer than the
// app takes, a date in the future, or a tag the app does not offer comes back as a problem.
import { resolveExercise } from './log-workout.js'
import { NOTE_MAX } from './history.js'
import { DAY_NOTE_TAGS, canNoteDay, dayNoteOf, withDayNote } from './day-notes.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const clean = v => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim() : '')

/**
 * Sets (replace) or extends (append) the standing note on an exercise. An empty text with
 * mode 'replace' removes the note. Append skips a line the note already holds, so asking twice
 * does not write it twice. → { exercise: { id, name }, note, previous } or { problems }.
 */
export function setExerciseNote(S, ref, text, { mode = 'replace' } = {}) {
  const problems = []
  if (mode !== 'replace' && mode !== 'append') problems.push({ field: 'mode', problem: 'replace or append' })
  if (typeof text !== 'string') problems.push({ field: 'text', problem: 'the note, as text' })
  const hit = resolveExercise(S, ref)
  if (hit.problem) problems.push({ field: 'exercise', exercise: ref ?? null, problem: hit.problem, ...(hit.candidates ? { candidates: hit.candidates } : {}) })
  if (problems.length) return { problems }
  const add = clean(text)
  if (mode === 'append' && !add) return { problems: [{ field: 'text', problem: 'nothing to append' }] }
  const notes = isMap(S.exNotes) ? S.exNotes : {}
  const previous = typeof notes[hit.id] === 'string' ? notes[hit.id].trim() : ''
  let next = add
  if (mode === 'append' && previous) next = previous.split('\n').includes(add) ? previous : previous + '\n' + add
  if (next.length > NOTE_MAX) return { problems: [{ field: 'text', problem: `too long: a note holds ${NOTE_MAX} characters, this would be ${next.length}` }] }
  const out = { ...notes }
  if (next) out[hit.id] = next; else delete out[hit.id]
  S.exNotes = out
  return { exercise: { id: hit.id, name: hit.name }, note: next || null, previous: previous || null }
}

/**
 * Sets the note on a day: a quick pick (`tag`), a line of text, or both; neither clears it. Only
 * today and earlier days take one (lib/day-notes.js says why). → { date, note, previous } or { problems }.
 */
export function setDayNote(S, iso, { tag, text } = {}, { now = Date.now(), today } = {}) {
  const problems = []
  if (!canNoteDay(iso, today)) problems.push({ field: 'date', problem: 'a real date (YYYY-MM-DD), today or earlier: a note on a future day reads as permission to skip it' })
  if (tag != null && tag !== '' && !DAY_NOTE_TAGS.includes(tag)) problems.push({ field: 'tag', problem: `one of ${DAY_NOTE_TAGS.join(', ')}` })
  if (text != null && typeof text !== 'string') problems.push({ field: 'text', problem: 'the note, as text' })
  const line = clean(text)
  if (line.length > NOTE_MAX) problems.push({ field: 'text', problem: `too long: ${NOTE_MAX} characters at most, this is ${line.length}` })
  if (problems.length) return { problems }
  const previous = dayNoteOf(S, iso)
  S.dayNotes = withDayNote(S.dayNotes, iso, { tag: tag || null, text: line }, now)
  return { date: iso, note: dayNoteOf(S, iso), previous }
}
