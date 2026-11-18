// set_exercise_note and set_day_note's rules (lib/notes-write.js).
import { describe, expect, it } from 'vitest'
import { setExerciseNote, setDayNote } from './notes-write.js'
import { NOTE_MAX, exNoteFor } from './history.js'
import { dayNoteOf } from './day-notes.js'

const doc = (over = {}) => ({ unit: 'lb', customEx: [{ id: 'c1', n: 'Balance hold', bp: 'lower legs', eq: 'body weight', custom: true }], exNotes: {}, dayNotes: {}, ...over })

describe('setExerciseNote', () => {
  it('replaces the standing note on an exercise by name or by id, and the app reads it back', () => {
    const S = doc()
    const r = setExerciseNote(S, 'balance hold', '  Eyes closed when it is easy  ')
    expect(r).toEqual({ exercise: { id: 'c1', name: 'Balance hold' }, note: 'Eyes closed when it is easy', previous: null })
    expect(exNoteFor(S, 'c1')).toBe('Eyes closed when it is easy')
    const again = setExerciseNote(S, 'c1', 'New text')
    expect(again).toMatchObject({ note: 'New text', previous: 'Eyes closed when it is easy' })
  })

  it('works on a catalogue exercise by id', () => {
    const S = doc()
    expect(setExerciseNote(S, '0715', 'Descente 3 s').exercise.name).toBe('side plank')
    expect(S.exNotes['0715']).toBe('Descente 3 s')
  })

  it('appends on a new line, and never twice', () => {
    const S = doc({ exNotes: { c1: 'Slow' } })
    expect(setExerciseNote(S, 'c1', 'Knee tracks over the toes', { mode: 'append' }).note).toBe('Slow\nKnee tracks over the toes')
    expect(setExerciseNote(S, 'c1', 'Slow', { mode: 'append' }).note).toBe('Slow\nKnee tracks over the toes')
    const empty = doc()
    expect(setExerciseNote(empty, 'c1', 'First', { mode: 'append' }).note).toBe('First')
  })

  it('an empty text removes the note; appending nothing is refused', () => {
    const S = doc({ exNotes: { c1: 'Slow', other: 'kept' } })
    expect(setExerciseNote(S, 'c1', '  ')).toMatchObject({ note: null, previous: 'Slow' })
    expect(S.exNotes).toEqual({ other: 'kept' })
    expect(setExerciseNote(S, 'c1', '', { mode: 'append' }).problems[0].field).toBe('text')
  })

  it('refuses an unknown or ambiguous exercise, a too-long note and a bad mode, changing nothing', () => {
    const S = doc({ exNotes: { c1: 'Slow' } })
    const before = JSON.stringify(S)
    expect(setExerciseNote(S, 'no such exercise at all', 'x').problems[0]).toMatchObject({ field: 'exercise' })
    expect(setExerciseNote(S, 'c1', 'x'.repeat(NOTE_MAX + 1)).problems[0].field).toBe('text')
    expect(setExerciseNote(S, 'c1', 'x'.repeat(NOTE_MAX), { mode: 'append' }).problems[0].field).toBe('text')
    expect(setExerciseNote(S, 'c1', 'x', { mode: 'merge' }).problems[0].field).toBe('mode')
    expect(JSON.stringify(S)).toBe(before)
  })
})

describe('setDayNote', () => {
  const today = '2026-11-17'

  it('writes a quick pick and a line, stamped, and the app reads it back', () => {
    const S = doc()
    const r = setDayNote(S, '2026-11-16', { tag: 'travel', text: 'Detroit' }, { now: 1234, today })
    expect(r).toEqual({ date: '2026-11-16', note: { tag: 'travel', text: 'Detroit' }, previous: null })
    expect(S.dayNotes['2026-11-16']).toEqual({ tag: 'travel', text: 'Detroit', _ts: 1234 })
    expect(dayNoteOf(S, '2026-11-16')).toEqual({ tag: 'travel', text: 'Detroit' })
  })

  it('takes a text alone or a tag alone, keeps other days, and reports what it replaced', () => {
    const S = doc({ dayNotes: { '2026-11-10': { tag: 'sick', _ts: 1 } } })
    setDayNote(S, '2026-11-17', { text: 'Show day, 25 000 steps' }, { now: 5, today })
    const r = setDayNote(S, '2026-11-17', { tag: 'rest' }, { now: 6, today })
    expect(r.previous).toEqual({ tag: null, text: 'Show day, 25 000 steps' })
    expect(S.dayNotes['2026-11-10']).toEqual({ tag: 'sick', _ts: 1 })
    expect(S.dayNotes['2026-11-17']).toEqual({ tag: 'rest', _ts: 6 })
  })

  it('clearing is a stamped empty entry, so the removal syncs', () => {
    const S = doc({ dayNotes: { '2026-11-16': { tag: 'sick', _ts: 1 } } })
    const r = setDayNote(S, '2026-11-16', {}, { now: 9, today })
    expect(r.note).toBeNull()
    expect(S.dayNotes['2026-11-16']).toEqual({ _ts: 9 })
  })

  it('refuses a future or malformed date, a tag the app does not have and a long text, changing nothing', () => {
    const S = doc()
    const before = JSON.stringify(S)
    expect(setDayNote(S, '2026-11-18', { text: 'x' }, { today }).problems[0].field).toBe('date')
    expect(setDayNote(S, 'tomorrow', { text: 'x' }, { today }).problems[0].field).toBe('date')
    expect(setDayNote(S, '2026-11-16', { tag: 'hungover' }, { today }).problems[0].field).toBe('tag')
    expect(setDayNote(S, '2026-11-16', { text: 'x'.repeat(NOTE_MAX + 1) }, { today }).problems[0].field).toBe('text')
    expect(JSON.stringify(S)).toBe(before)
  })
})
