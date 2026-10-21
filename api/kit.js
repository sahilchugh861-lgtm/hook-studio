import { db, q, now, newId, fail, HttpErr, migrate, currentUser, secretsReady, clean, isUrl } from '../lib/core.js';

const KINDS = ['photos', 'videos', 'broll', 'logo', 'music', 'fonts', 'refs', 'docs', 'other'];
const TEXT_FIELDS = { about: 3000, audience: 3000, tone: 2000, style: 3000, dos: 2000, donts: 2000, fonts: 400 };

let ready = null;
function setup() {
  if (!ready) ready = (async () => {
    await migrate();
    const v = await q("select value from settings where key = 'kit_schema'");
    if (v[0]?.value === '1') return;
    await q(`create table if not exists kit_profiles(workspace_id text primary key, data text not null default '{}', updated_at bigint)`);
    await q(`create table if not exists kit_assets(id text primary key, workspace_id text not null, kind text not null, label text not null, url text not null, note text not null default '', created_at bigint not null)`);
    await q(`create index if not exists kit_assets_ws on kit_assets(workspace_id)`);
    await q("insert into settings(key, value) values('kit_schema', '1') on conflict (key) do update set value = '1'");
  })().catch(e => { ready = null; throw e; });
  return ready;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });
  if (!db) return res.status(503).json({ error: 'db_missing', message: 'The database is not connected yet.' });
  if (!secretsReady()) return res.status(503).json({ error: 'config', message: 'The app is missing its session secret.' });
  try {
    await setup();
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    res.status(200).json(await route(req, b || {}));
  } catch (e) {
    if (e instanceof HttpErr) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error(e);
    res.status(500).json({ error: 'server', message: 'Something went wrong on the server. Try again.' });
  }
}

async function roleIn(u, ws) {
  if (u.is_admin) return 'admin';
  const r = await q('select role from memberships where user_id = $1 and workspace_id = $2', [u.id, ws]);
  return r[0]?.role || null;
}
function readProfile(raw) {
  let p = {};
  try { p = JSON.parse(raw || '{}') || {}; } catch {}
  return p;
}
async function kitOf(ws) {
  const [prof, assets] = await Promise.all([
    q('select data from kit_profiles where workspace_id = $1', [ws]),
    q('select * from kit_assets where workspace_id = $1 order by created_at', [ws])
  ]);
  return {
    profile: readProfile(prof[0]?.data),
    assets: assets.map(a => ({ id: a.id, kind: a.kind, label: a.label, url: a.url, note: a.note, createdAt: Number(a.created_at) }))
  };
}
function cleanAsset(b) {
  const kind = KINDS.includes(b.kind) ? b.kind : 'other';
  const url = clean(b.url, 1500);
  if (!isUrl(url)) fail(400, 'bad', 'Paste a full link that starts with https://');
  const label = clean(b.label, 120) || 'Untitled';
  return { kind, url, label, note: clean(b.note, 600) };
}

async function route(req, b) {
  const u = await currentUser(req);
  if (!u) fail(401, 'auth', 'Please log in again.');

  if (b.a === 'get') {
    const ws = String(b.ws || '');
    const role = await roleIn(u, ws);
    if (role !== 'admin' && role !== 'editor') fail(403, 'forbidden', "You don't have access to this client kit.");
    return await kitOf(ws);
  }

  if (!u.is_admin) fail(403, 'forbidden', 'Only the admin can change the client kit.');

  switch (b.a) {
    case 'profile-set': {
      const ws = String(b.ws || '');
      if (!(await q('select 1 from workspaces where id = $1', [ws])).length) fail(404, 'not_found', 'This workspace no longer exists.');
      const cur = readProfile((await q('select data from kit_profiles where workspace_id = $1', [ws]))[0]?.data);
      const p = b.patch || {};
      for (const [k, max] of Object.entries(TEXT_FIELDS)) if (k in p) cur[k] = clean(p[k], max);
      if ('masterFolder' in p) {
        const l = clean(p.masterFolder, 1500);
        if (l && !isUrl(l)) fail(400, 'bad', 'Paste a full link that starts with https://');
        cur.masterFolder = l;
      }
      if ('colors' in p) {
        cur.colors = (Array.isArray(p.colors) ? p.colors : []).slice(0, 16)
          .map(c => ({ name: clean(c && c.name, 40), hex: String(c && c.hex || '').trim().toLowerCase() }))
          .filter(c => /^#[0-9a-f]{6}$/.test(c.hex));
      }
      await q(`insert into kit_profiles(workspace_id, data, updated_at) values($1, $2, $3)
               on conflict (workspace_id) do update set data = $2, updated_at = $3`, [ws, JSON.stringify(cur), now()]);
      return await kitOf(ws);
    }
    case 'asset-add': {
      const ws = String(b.ws || '');
      if (!(await q('select 1 from workspaces where id = $1', [ws])).length) fail(404, 'not_found', 'This workspace no longer exists.');
      const count = (await q('select count(*)::int as c from kit_assets where workspace_id = $1', [ws]))[0].c;
      if (count >= 300) fail(400, 'bad', 'This kit already has 300 links. Group files into Drive folders instead.');
      const a = cleanAsset(b);
      await q('insert into kit_assets(id, workspace_id, kind, label, url, note, created_at) values($1,$2,$3,$4,$5,$6,$7)',
        [newId('ka_'), ws, a.kind, a.label, a.url, a.note, now()]);
      return await kitOf(ws);
    }
    case 'asset-update': {
      const cur = (await q('select * from kit_assets where id = $1', [String(b.id || '')]))[0];
      if (!cur) fail(404, 'not_found', 'That link no longer exists. Refresh the page.');
      const a = cleanAsset({ ...cur, ...b });
      await q('update kit_assets set kind = $1, label = $2, url = $3, note = $4 where id = $5', [a.kind, a.label, a.url, a.note, cur.id]);
      return await kitOf(cur.workspace_id);
    }
    case 'asset-delete': {
      const cur = (await q('select workspace_id from kit_assets where id = $1', [String(b.id || '')]))[0];
      if (!cur) fail(404, 'not_found', 'That link no longer exists. Refresh the page.');
      await q('delete from kit_assets where id = $1', [String(b.id)]);
      return await kitOf(cur.workspace_id);
    }
  }
  fail(400, 'bad', 'Unknown action.');
}
