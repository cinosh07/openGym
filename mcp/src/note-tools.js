/* The user's notes: get_notes reads them, set_exercise_note and set_day_note write them. Two kinds,
   as the app has them: a standing note on an exercise (the tip shown with it in every workout:
   "descente 3 s", "right knee: stop at 3/10") and a note on a day ("travelling", "show day, 25 000
   steps"). They save through the openGym api like the plan's tools (routine-tools.js writePlan),
   with a paired session or a scoped token that holds Notes at "Change directly". The rules are
   frontend/src/lib/notes-write.js.

   A routine's own tip on an exercise slot is not a note in this sense: it goes with the routine
   (create_routine and update_routine take a `note` per exercise). */
import { z } from 'zod'
import { isoDate, noState, todayIso } from './tools.js'
import { getState } from './state.js'
import { writePlan } from './routine-tools.js'
import { setExerciseNote, setDayNote } from '../../frontend/src/lib/notes-write.js'
import { exNoteFor, NOTE_MAX } from '../../frontend/src/lib/history.js'
import { DAY_NOTE_TAGS, readDayNote } from '../../frontend/src/lib/day-notes.js'
import { resolveExercise } from '../../frontend/src/lib/log-workout.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

export const getNotes = {
  name: 'get_notes',
  description: 'Read the user\'s notes: the standing note on each exercise that has one, and the notes on days (a quick pick like "sick" or "travel", a line of text, or both), newest first. Read before you write one: set_exercise_note replaces the old text unless you ask it to append.',
  schema: {
    from: isoDate().optional().describe('Inclusive start date YYYY-MM-DD, for the day notes.'),
    to: isoDate().optional().describe('Inclusive end date YYYY-MM-DD, for the day notes. Defaults to today.'),
    limit: z.number().int().min(1).max(200).optional().describe('Most day notes to return, 60 by default.'),
  },
  handler: ({ from, to, limit }) => {
    const S = getState()
    if (!S) return noState()
    const hi = to || todayIso()
    const exercises = Object.keys(isMap(S.exNotes) ? S.exNotes : {})
      .map(id => ({ id, text: exNoteFor(S, id) }))
      .filter(n => n.text)
      .map(n => ({ exercise_id: n.id, exercise: resolveExercise(S, n.id).name || n.id, note: n.text }))
      .sort((a, b) => a.exercise.localeCompare(b.exercise))
    const days = Object.keys(isMap(S.dayNotes) ? S.dayNotes : {})
      .filter(d => (!from || d >= from) && d <= hi)
      .map(d => ({ date: d, note: readDayNote(S.dayNotes[d]) }))
      .filter(d => d.note)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit || 60)
      .map(d => ({ date: d.date, ...(d.note.tag ? { tag: d.note.tag } : {}), ...(d.note.text ? { text: d.note.text } : {}) }))
    return { exercise_notes: exercises, day_notes: days, day_note_tags: DAY_NOTE_TAGS }
  },
}

export const setExerciseNoteTool = {
  name: 'set_exercise_note',
  description: [
    'Write the standing note on an exercise: the tip the app shows with it in every workout ("descente 3 s, chaque jambe", "stop at 3/10 knee pain"). Find the exercise with search_exercises and pass its id, or its exact name.',
    'mode "replace" (the default) sets the note to exactly this text and an empty text removes it; mode "append" adds the text on a new line after what is there (and does not add a line twice). Read get_notes first so you do not overwrite a note the user wrote.',
    `A note holds ${NOTE_MAX} characters. This is not a routine's per-exercise tip (that is the \`note\` of create_routine and update_routine). Call with dry_run: true first when you had to interpret anything, and save once the user agrees.`,
  ].join(' '),
  schema: {
    exercise: z.string().min(1).max(120).describe('Exercise name as the user said it, or an exercise id from search_exercises or an earlier answer.'),
    text: z.string().max(NOTE_MAX).describe('The note. With mode "replace", empty removes the note.'),
    mode: z.enum(['replace', 'append']).optional().describe('replace (default): the note becomes exactly this text. append: add it after the existing note.'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const r = setExerciseNote(S, p.exercise, p.text, { mode: p.mode || 'replace' })
      return r.problems ? r : { ...r, what: `note on exercise ${r.exercise.id}` }
    },
    view: (S, out) => ({ exercise: out.exercise, note: out.note, previous_note: out.previous }),
  }),
}

export const setDayNoteTool = {
  name: 'set_day_note',
  description: [
    'Write the note on a day: a quick pick (sick, travel, rest or injured), a line of text, or both. A day with a note counts as excused: the app\'s missed-day nudge and workout reminder leave it alone, and the calendar shows it.',
    'Only today and earlier days take one (a note on a future day reads as permission to skip it). It replaces the day\'s note; give neither tag nor text to clear it. Read get_notes first so you do not overwrite one the user wrote.',
    'Call with dry_run: true first when you had to interpret anything, and save once the user agrees.',
  ].join(' '),
  schema: {
    date: isoDate().describe('YYYY-MM-DD, today or earlier.'),
    tag: z.enum(DAY_NOTE_TAGS).optional().describe('A quick pick: sick, travel, rest or injured.'),
    text: z.string().max(NOTE_MAX).optional().describe('A line of your own ("Detroit, show day").'),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => writePlan({
    env, fetchImpl, dryRun: p.dry_run === true,
    change: S => {
      const r = setDayNote(S, p.date, { tag: p.tag, text: p.text })
      return r.problems ? r : { ...r, what: `note on ${r.date}` }
    },
    view: (S, out) => ({ date: out.date, note: out.note, previous_note: out.previous }),
  }),
}

export const NOTE_TOOLS = [getNotes, setExerciseNoteTool, setDayNoteTool]
