/* GET /api/token/run/today against the real server.js in a child: the structured run session of a day,
   steps unrolled (run-today.js), for the Trail Coach app. Needs Plans at view or more. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}:c`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const USERS = [
  { id: 'u_t_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_t_2', name: 'Two', created: new Date().toISOString() }
];
const STATE = uid => ({
  _rev: 3, unit: 'kg', weekStart: 1,
  runPlan: { '2026-11-20': { kind: 'run', type: 'quality', name: 'VO2', min: 25, _ts: 1, steps: [
    { name: 'Warm', intensity: 'warmup', action: 'run', duration_s: 600, hr_min: 110, hr_max: 135, climb_margin: true },
    { repeat: 2, steps: [
      { name: 'Z4', intensity: 'interval', action: 'run', duration_s: 180, hr_min: 165, hr_max: 178, climb_margin: false },
      { name: 'Rec', intensity: 'recovery', action: 'walk', duration_s: 120, hr_min: 60, hr_max: 140, climb_margin: true }] }] },
    '2026-11-21': { _ts: 2 } },
  activities: { a: { d: '2026-11-20', sport: 'run', min: 30, km: 5, src: 'garmin', _ts: 1 } },
  workouts: [{ id: 'w1', d: '2026-11-01', name: uid, start: 1, end: 2, entries: [] }],
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] }], week: { 1: ['r1'] },
  bodyweight: [{ d: '2026-11-01', w: 80 }], measurements: [{ d: '2026-11-01', waist: 80 }],
  dayPhotos: { ['a'.repeat(64)]: { d: '2026-11-01', m: { hash: 'a'.repeat(64), mime: 'image/jpeg' } } },
  coach: { chat: [{ role: 'user', text: 'private' }] }, customEx: []
});

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-tokens-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  for (const u of USERS) fs.writeFileSync(path.join(dataDir, `state-${u.id}.json`), JSON.stringify(STATE(u.id)));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: 'u_t_1', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, { headers = {}, body } = {}) => {
    const r = await fetch(h.api + p, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  return h;
}
const page = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}`, 'Sec-Fetch-Site': 'same-origin' });
const bearer = tok => ({ Authorization: 'Bearer ' + tok });


test('a day session comes back flattened, with its scope checked', async t => {
  const h = await startServer(t);
  const mk = async scopes => (await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes } })).body.token;
  const plans = await mk({ plans: 'view' });
  const r = await h.call('GET', '/api/token/run/today?date=2026-11-20', { headers: bearer(plans) });
  assert.equal(r.status, 200);
  assert.equal(r.body.date, '2026-11-20');
  assert.equal(r.body.session.name, 'VO2');
  assert.equal(r.body.session.done, true);
  assert.equal(r.body.session.total_s, 600 + 2 * 300);
  assert.deepEqual(r.body.session.steps.map(s => [s.index, s.name, s.block && s.block.n]), [[0, 'Warm', null], [1, 'Z4', 1], [2, 'Rec', 1], [3, 'Z4', 2], [4, 'Rec', 2]]);
  assert.equal(r.body.session.steps[1].hr_min, 165);
  // a cleared date and a date with nothing: no session
  assert.equal((await h.call('GET', '/api/token/run/today?date=2026-11-21', { headers: bearer(plans) })).body.session, null);
  assert.equal((await h.call('GET', '/api/token/run/today?date=2026-12-01', { headers: bearer(plans) })).body.session, null);
  // today by default: a well-formed answer for whatever today is
  const today = await h.call('GET', '/api/token/run/today', { headers: bearer(plans) });
  assert.equal(today.status, 200);
  assert.ok(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(today.body.date));
  assert.equal((await h.call('GET', '/api/token/run/today?date=tomorrow', { headers: bearer(plans) })).status, 400);
});

test('a token without Plans, or none, is refused', async t => {
  const h = await startServer(t);
  const workoutsOnly = (await h.call('POST', '/api/tokens', { headers: page('u_t_1'), body: { scopes: { workouts: 'view' } } })).body.token;
  assert.equal((await h.call('GET', '/api/token/run/today', { headers: bearer(workoutsOnly) })).status, 403);
  assert.equal((await h.call('GET', '/api/token/run/today')).status, 401);
  assert.equal((await h.call('GET', '/api/token/run/today', { headers: page('u_t_1') })).status, 401);
});
