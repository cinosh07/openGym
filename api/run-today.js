// The structured run session of a day, flattened for the Trail Coach app (GET /api/token/run/today).
// The steps are stored as the frontend's lib/run-session.js checks them (blocks with a repeat count);
// here they are unrolled one by one, numbered from 0, with `block: { n, of }` on a step that comes
// from a block. The API image cannot import the frontend, so this unroll is a hand copy of
// run-session.js unrollSteps and totalsOf: frontend/src/lib/run-session.test.js compares the two.
// Read-only and trusting what is stored (set_run_session and the app's own writes validate): it
// only skips what is not shaped like a step, so a hand-edited document cannot break the endpoint.

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = v => (Number.isFinite(Number(v)) && v != null && v !== '' ? Number(v) : null);

export function unrollSteps(steps) {
  const flat = [];
  for (const item of Array.isArray(steps) ? steps : []) {
    if (item && item.repeat) {
      for (let n = 1; n <= item.repeat; n++) for (const s of item.steps || []) flat.push({ ...s, block: { n, of: item.repeat } });
    } else if (item) flat.push({ ...item, block: null });
  }
  return flat.map((s, index) => ({ index, ...s }));
}

export function totalsOf(flat) {
  let s = 0, m = 0;
  for (const x of flat) { s += x.duration_s || 0; m += x.distance_m || 0; }
  return { total_s: s, total_m: m };
}

/** Whether a run or trail run is logged for `iso` (on its day, or linked to it with `sessionDate`). */
function isDone(S, iso) {
  const acts = isMap(S?.activities) ? Object.values(S.activities) : [];
  return acts.some(a => isMap(a) && (a.sport === 'run' || a.sport === 'trail') && ISO.test(String(a.d || '')) && (a.sessionDate || a.d) === iso);
}

/**
 * `state`'s session for `iso`: { date, session: null } when there is none, else
 * { date, session: { name, type, kind, done, note?, steps, total_s, total_m } } (a plain planned run
 * with no steps has `steps: []`, so the app can tell "nothing to run on the watch").
 */
export function runToday(state, iso) {
  const entry = isMap(state?.runPlan) ? state.runPlan[iso] : null;
  if (!isMap(entry) || !entry.kind) return { date: iso, session: null };
  const flat = Array.isArray(entry.steps) ? unrollSteps(entry.steps) : [];
  const t = totalsOf(flat);
  return {
    date: iso,
    session: {
      name: typeof entry.name === 'string' ? entry.name : null,
      type: typeof entry.type === 'string' ? entry.type : null,
      kind: entry.kind,
      done: isDone(state, iso),
      ...(typeof entry.note === 'string' && entry.note ? { note: entry.note } : {}),
      ...(num(entry.min) ? { min: num(entry.min) } : {}),
      ...(num(entry.km) ? { km: num(entry.km) } : {}),
      steps: flat,
      ...t,
    },
  };
}
