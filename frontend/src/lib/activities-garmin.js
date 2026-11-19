// Garmin runs and rides into S.activities, for the MCP server's import_garmin_activities tool.
// Pure and beside its test, like log-workout.js: it decides what lands in the history.
//
// The records are what the Pi's Garmin collector keeps in activities.json (Trail-Coarch,
// collecteur/): { id, date, start, type, name, km, hours, climb_m, avg_hr, max_hr, zones } and, when
// the collector has been taught them, descent_m, cadence, te, te_anaerobic, load. Every field but
// the id and the date may be missing: Garmin gives null for what the watch did not measure, and
// null is never a zero here.
//
// Rules that matter:
//  - Importing the same file twice changes nothing (the entry's id comes from Garmin's id).
//  - A session removed in openGym (a stamped empty entry) is never brought back.
//  - A session already read from Health Connect / Apple Health over the same time is ENRICHED with
//    the Garmin numbers (heart rate, climb, zones…) instead of getting a second entry.
//  - Gym workouts (strength, HIIT, yoga…) and walks are not imported: openGym logs strength itself.
import { readActivity, SPORTS } from './activities.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const num = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

// Garmin's activity type keys to a sport and a terrain. `null` = not imported.
const TYPE = {
  running: { sport: 'run', terrain: 'road' },
  street_running: { sport: 'run', terrain: 'road' },
  track_running: { sport: 'run', terrain: 'track' },
  treadmill_running: { sport: 'run', terrain: 'treadmill' },
  indoor_running: { sport: 'run', terrain: 'treadmill' },
  virtual_run: { sport: 'run', terrain: 'treadmill' },
  trail_running: { sport: 'trail', terrain: 'trail' },
  ultra_run: { sport: 'run' },
  hiking: { sport: 'hike' },
  cycling: { sport: 'ride' }, road_biking: { sport: 'ride' }, mountain_biking: { sport: 'ride' }, gravel_cycling: { sport: 'ride' },
  indoor_cycling: { sport: 'ride' }, virtual_ride: { sport: 'ride' }, e_bike_fitness: { sport: 'ride' },
  lap_swimming: { sport: 'swim' }, open_water_swimming: { sport: 'swim' },
  resort_skiing_snowboarding_ws: { sport: 'ski' }, resort_skiing: { sport: 'ski' }, cross_country_skiing_ws: { sport: 'ski' }, backcountry_skiing: { sport: 'ski' },
  rowing: { sport: 'row' }, indoor_rowing: null,
  walking: null, casual_walking: null, speed_walking: null,
  strength_training: null, hiit: null, yoga: null, pilates: null, elliptical: null, stair_climbing: null, cardio: null, indoor_cardio: null,
}

/** The sport (and terrain) a Garmin type key means, or null for one that is not imported. */
export function sportOfGarminType(type, name = '') {
  const key = String(type || '').toLowerCase()
  if (Object.hasOwn(TYPE, key)) return TYPE[key]
  if (/trail/.test(key) || /trail/i.test(String(name))) return { sport: 'trail', terrain: 'trail' }
  if (/run/.test(key)) return { sport: 'run' }
  return { sport: SPORTS.includes(key) ? key : 'other' }
}

const zonesOf = z => {
  if (Array.isArray(z)) return z.length === 5 ? z : null
  if (!isMap(z)) return null
  const pick = i => z[`Z${i}`] ?? z[`z${i}`] ?? z[`zone${i}`] ?? z[i]
  const out = [1, 2, 3, 4, 5].map(pick)
  return out.some(v => v == null) ? null : out
}

// Garmin's start is "2026-11-14 08:05:33" (local) or an ISO string; either way a time, or nothing.
const startMs = v => {
  if (typeof v === 'number' && v > 1e11) return v
  const t = Date.parse(String(v || '').replace(' ', 'T'))
  return Number.isFinite(t) ? t : null
}

/**
 * One collector record as an activity ({ d, sport, min, … src: 'garmin' }), or null when it is not
 * one to import (a gym workout, a walk, under five minutes, no usable date).
 */
export function activityFromGarmin(rec) {
  if (!isMap(rec) || rec.id == null || String(rec.id).trim() === '') return null
  const kind = sportOfGarminType(rec.type, rec.name)
  if (!kind) return null
  const hours = num(rec.hours)
  const min = hours != null ? Math.round(hours * 60) : num(rec.min) != null ? Math.round(num(rec.min)) : null
  if (!(min >= 5)) return null
  const at = startMs(rec.start)
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(rec.date || '')) ? String(rec.date).slice(0, 10) : at ? isoLocal(at) : null
  if (!date) return null
  const km = num(rec.km)
  const a = readActivity({
    d: date, sport: kind.sport, min, km: km > 0 ? km : undefined, at: at || undefined,
    title: typeof rec.name === 'string' ? rec.name : '', src: 'garmin',
    terrain: kind.terrain, asc: num(rec.climb_m ?? rec.asc), desc: num(rec.descent_m ?? rec.desc),
    avgHr: num(rec.avg_hr ?? rec.avgHr), maxHr: num(rec.max_hr ?? rec.maxHr), zones: zonesOf(rec.zones),
    cad: num(rec.cadence ?? rec.cad), te: num(rec.te), teAn: num(rec.te_anaerobic ?? rec.teAn), load: num(rec.load),
    gid: String(rec.id),
  })
  return a
}

const isoLocal = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const idOf = gid => 'gm' + String(gid).replace(/[^A-Za-z0-9]/g, '').slice(0, 30)

// The run fields Garmin supplies: only these are ever added to an entry that already exists.
const GARMIN_FIELDS = ['terrain', 'asc', 'desc', 'avgHr', 'maxHr', 'zones', 'cad', 'te', 'teAn', 'load', 'gid']
const OVERLAP_MS = 20 * 60e3

// An entry read from the health store over the same session: same day, same kind of sport, and its
// start within twenty minutes (no start on either side: distances within 10%).
function sameSession(existing, a) {
  if (existing.d !== a.d) return false
  const run = s => s === 'run' || s === 'trail'
  if (existing.sport !== a.sport && !(run(existing.sport) && run(a.sport))) return false
  if (existing.at > 0 && a.at > 0) return Math.abs(existing.at - a.at) <= OVERLAP_MS
  if (existing.km > 0 && a.km > 0) return Math.abs(existing.km - a.km) / a.km <= 0.1
  return false
}

/**
 * Collector records into S.activities (mutates S). New sessions are added; one already here (by
 * Garmin's id, or a health-store entry over the same time) gets the Garmin numbers it lacks and is
 * otherwise left as it is; a removed one is never brought back. Returns the ids touched:
 * { added, enriched, skipped } (`skipped` counts records that are not imported).
 */
export function mergeGarminActivities(S, records, { now = Date.now() } = {}) {
  const map = isMap(S.activities) ? S.activities : {}
  const out = { added: [], enriched: [], skipped: 0 }
  for (const rec of Array.isArray(records) ? records : []) {
    const a = activityFromGarmin(rec)
    if (!a) { out.skipped++; continue }
    const id = idOf(a.gid)
    if (Object.hasOwn(map, id)) {
      const cur = readActivity(map[id])
      if (!cur) continue // removed here: stays removed
      if (enrich(map, id, cur, a, now)) out.enriched.push(id)
      continue
    }
    // The same session by Garmin's id under another key (a health-store entry enriched earlier), or
    // a health-store entry over the same time that has no Garmin id yet.
    let twin = null
    for (const [eid, e] of Object.entries(map)) {
      const cur = readActivity(e)
      if (!cur) continue
      if (cur.gid === a.gid || (!cur.gid && sameSession(cur, a))) { twin = { eid, cur }; break }
    }
    if (twin) { if (enrich(map, twin.eid, twin.cur, a, now)) out.enriched.push(twin.eid); continue }
    map[id] = { ...a, _ts: now }
    out.added.push(id)
  }
  if (out.added.length || out.enriched.length) S.activities = map
  return out
}

// Adds the Garmin fields the entry does not have; a time and a distance it already has stay. A
// session that had no title takes Garmin's. → whether anything changed.
function enrich(map, id, cur, a, now) {
  const next = { ...map[id] }
  let changed = false
  for (const f of GARMIN_FIELDS) {
    if (cur[f] == null && a[f] != null) { next[f] = a[f]; changed = true }
  }
  if (!cur.km && a.km) { next.km = a.km; changed = true }
  if (!cur.title && a.title) { next.title = a.title; changed = true }
  if (cur.sport === 'run' && a.sport === 'trail') { next.sport = 'trail'; changed = true }
  if (!changed) return false
  map[id] = { ...next, _ts: now }
  return true
}
