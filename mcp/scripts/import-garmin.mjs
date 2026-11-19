#!/usr/bin/env node
/* Bring the Garmin collector's runs into openGym.
 *
 *   OPENGYM_URL=http://127.0.0.1:3000 OPENGYM_TOKEN=… node scripts/import-garmin.mjs /home/pi/trail-data/activities.json [--dry-run]
 *
 * The file is the collector's activities.json (a list of { id, date, start, type, name, km, hours,
 * climb_m, avg_hr, max_hr, zones, … }). It goes through the same import_garmin_activities tool an
 * assistant uses, so it is safe to run as often as you like: a session already in openGym changes
 * nothing, one you removed stays removed, and a run the phone already read from Health Connect gets
 * the Garmin numbers added instead of a second entry. Prints one JSON line with what happened. */
import fs from 'node:fs'
import { importGarminActivities } from '../src/run-tools.js'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const file = args.find(a => !a.startsWith('--'))
if (!file) {
  console.error('usage: node scripts/import-garmin.mjs <activities.json> [--dry-run]   (OPENGYM_URL and OPENGYM_TOKEN in the environment)')
  process.exit(2)
}

let list
try {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  list = Array.isArray(doc) ? doc : Array.isArray(doc?.activities) ? doc.activities : null
} catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2) }
if (!list) { console.error(`${file}: expected a list of activities`); process.exit(2) }

const total = { added: 0, enriched: 0, skipped: 0 }
try {
  // Oldest first, a batch at a time: each batch is one save of the profile.
  const sorted = [...list].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
  for (let i = 0; i < sorted.length; i += 200) {
    const r = await importGarminActivities.handler({ activities: sorted.slice(i, i + 200), dry_run: dry })
    if (r.problems) throw new Error(JSON.stringify(r.problems))
    const s = r.would_save || r
    total.added += s.added || 0; total.enriched += s.enriched || 0; total.skipped += s.skipped || 0
  }
} catch (e) { console.error(`${e.code || 'ERROR'}: ${e.message}`); process.exit(1) }
console.log(JSON.stringify({ file, records: list.length, dry_run: dry, ...total }))
