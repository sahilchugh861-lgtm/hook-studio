import crypto from 'node:crypto';
import { db, q, migrate, now } from '../lib/core.js';

// Read-only feed of new board activity for the hourly email alert.
// GET /api/activity?key=NOTIFY_KEY&since=<ms>
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = String(req.query?.key || '');
  const expected = process.env.NOTIFY_KEY || '';
  if (!expected || key.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    return res.status(401).json({ error: 'auth' });
  }
  if (!db) return res.status(503).json({ error: 'db_missing' });
  await migrate();
  await q('create table if not exists settings(key text primary key, value text not null)');
  const consume = req.query?.consume === '1';
  let since = Number(req.query?.since) || 0;
  if (!since) {
    const row = (await q("select value from settings where key = 'last_notify'"))[0];
    since = row ? Number(row.value) : now() - 3600e3;
  }
  const stamp = now();
  const [ws, camps, angles, items, users, videos, comments] = await Promise.all([
    q('select * from workspaces'), q('select * from campaigns'), q('select * from angles'), q('select id, kind, n, angle_id from items'),
    q('select id, name, is_admin from users'),
    q('select * from videos where ready_at > $1 or approved_at > $1 or reviewed_at > $1', [since]),
    q('select * from comments where at > $1 order by at', [since])
  ]);
  const by = arr => Object.fromEntries(arr.map(r => [r.id, r]));
  const W = by(ws), C = by(camps), A = by(angles), I = by(items), U = by(users);
  const vidByKey = Object.fromEntries(videos.map(v => [v.key, v]));
  const adName = key => {
    const [h, b, c] = String(key).split('__');
    const hi = I[h], bi = I[b], ci = I[c];
    const ang = hi && A[hi.angle_id] || null;
    if (!hi || !bi || !ci || !ang) return { name: key, angle: '', ws: null };
    const w = W[ang.workspace_id], camp = C[ang.campaign_id];
    return { name: `${w?.client_code || 'CLIENT'}_${camp?.code || 'C1'}_${ang.code}_H${hi.n}_B${bi.n}_C${ci.n}`, angle: ang.name, ws: w };
  };
  const out = [];
  for (const v of videos) {
    const n = adName(v.key);
    const base = { client: n.ws?.name || '', adName: n.name, angle: n.angle, driveLink: v.drive_link };
    if (v.status === 'ready' && Number(v.ready_at) > since) out.push({ type: 'Ready for review', who: U[v.updated_by]?.name || '', ...base });
    if (v.status === 'approved' && Number(v.approved_at) > since) out.push({ type: 'Approved by client', who: U[v.reviewed_by]?.name || '', note: v.client_note, ...base });
    if (v.status === 'changes' && Number(v.reviewed_at) > since) out.push({ type: 'Client asked for changes', who: U[v.reviewed_by]?.name || '', note: v.client_note, ...base });
  }
  for (const c of comments) {
    if (U[c.by_user]?.is_admin) continue;
    const n = adName(c.video_key);
    out.push({ type: 'New comment', client: n.ws?.name || '', adName: n.name, angle: n.angle, who: U[c.by_user]?.name || '', note: (c.tc ? c.tc + ' ' : '') + c.text, driveLink: vidByKey[c.video_key]?.drive_link || '' });
  }
  if (consume) await q("insert into settings(key, value) values('last_notify', $1) on conflict (key) do update set value = $1", [String(stamp)]);
  res.status(200).json({ now: stamp, since, count: out.length, items: out });
}
