import {
  db, q, now, newId, newToken, fail, HttpErr, migrate, hashPw, checkPw, setSessionCookie, clearSessionCookie,
  currentUser, secretsReady, shape, TYPE_CODES, clean, isUrl, codeOf
} from '../lib/core.js';

const TYPES = Object.keys(TYPE_CODES);
const KINDS = ['hooks', 'bodies', 'ctas'];
const STATUSES = ['todo', 'editing', 'ready', 'changes', 'approved'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });
  if (!db) return res.status(503).json({ error: 'db_missing', message: 'The database is not connected yet.' });
  if (!secretsReady()) return res.status(503).json({ error: 'config', message: 'The app is missing its session secret.' });
  try {
    await migrate();
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const out = await route(req, res, body || {});
    res.status(200).json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpErr) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error(e);
    res.status(500).json({ error: 'server', message: 'Something went wrong on the server. Try again.' });
  }
}

/* ---------- helpers ---------- */
async function needUser(req) { const u = await currentUser(req); if (!u) fail(401, 'auth', 'Please log in again.'); return u; }
function needAdmin(u) { if (!u.is_admin) fail(403, 'forbidden', 'Only the admin can do that.'); }
async function roleIn(u, ws) {
  if (u.is_admin) return 'admin';
  const r = await q('select role from memberships where user_id = $1 and workspace_id = $2', [u.id, ws]);
  return r[0]?.role || null;
}
async function one(table, id) {
  const r = await q(`select * from ${table} where id = $1`, [id]);
  if (!r[0]) fail(404, 'not_found', 'That item no longer exists. Refresh the page.');
  return r[0];
}
async function angleCode(campaignId, type, name, skipId = '') {
  let base = TYPE_CODES[type] || codeOf(name, 6) || 'CUSTOM';
  const rows = await q('select code from angles where campaign_id = $1 and id <> $2', [campaignId, skipId]);
  const taken = new Set(rows.map(r => r.code));
  if (!taken.has(base)) return base;
  let i = 2; while (taken.has(base + i)) i++;
  return base + i;
}
async function addItems(angle, kind, texts) {
  if (!KINDS.includes(kind)) fail(400, 'bad', 'Unknown item type.');
  const existing = await q('select text, n from items where angle_id = $1 and kind = $2', [angle.id, kind]);
  const seen = new Set(existing.map(i => i.text.trim().toLowerCase()));
  let n = existing.reduce((m, i) => Math.max(m, i.n), 0), added = 0;
  for (const raw of (Array.isArray(texts) ? texts : []).slice(0, 200)) {
    const text = clean(raw, 6000);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    await q('insert into items(id, workspace_id, campaign_id, angle_id, kind, text, n, created_at) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [newId('i_'), angle.workspace_id, angle.campaign_id, angle.id, kind, text, ++n, now()]);
    added++;
  }
  return added;
}
async function createAngle(campaign, type, name, why) {
  type = TYPES.includes(type) ? type : 'CUSTOM';
  name = clean(name, 120) || (type[0] + type.slice(1).toLowerCase());
  const ord = (await q('select count(*)::int as c from angles where campaign_id = $1', [campaign.id]))[0].c;
  const id = newId('a_');
  await q('insert into angles(id, workspace_id, campaign_id, type, name, why, code, ord, created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, campaign.workspace_id, campaign.id, type, name, clean(why, 400), await angleCode(campaign.id, type, name), ord, now()]);
  return (await q('select * from angles where id = $1', [id]))[0];
}
async function deleteVideos(where, params) {
  const keys = (await q(`select key from videos where ${where}`, params)).map(r => r.key);
  if (keys.length) {
    await q('delete from comments where video_key = any($1)', [keys]);
    await q('delete from videos where key = any($1)', [keys]);
  }
}
async function resolveVideo(key) {
  const parts = String(key || '').split('__');
  if (parts.length !== 3) fail(400, 'bad', 'Unknown video.');
  // One round trip: the three items, their angle and any existing video row.
  const rows = await q(`select h.id as h_id, b.id as b_id, c.id as c_id, a.id as a_id, a.workspace_id, a.campaign_id, a.editor_id as a_editor,
      v.key as v_key, v.editor_id, v.status, v.drive_link, v.editor_note, v.client_note, v.ready_at, v.approved_at, v.reviewed_at, v.reviewed_by
    from items h
    join items b on b.id = $2 and b.kind = 'bodies' and b.angle_id = h.angle_id
    join items c on c.id = $3 and c.kind = 'ctas' and c.angle_id = h.angle_id
    join angles a on a.id = h.angle_id
    left join videos v on v.key = $4
    where h.id = $1 and h.kind = 'hooks'`, [parts[0], parts[1], parts[2], key]);
  const r = rows[0];
  if (!r) fail(404, 'not_found', 'This video no longer exists. Refresh the page.');
  const v = r.v_key ? { editor_id: r.editor_id, status: r.status, drive_link: r.drive_link, editor_note: r.editor_note, client_note: r.client_note,
    ready_at: r.ready_at, approved_at: r.approved_at, reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by } : null;
  return { key, h: { id: r.h_id }, b: { id: r.b_id }, c: { id: r.c_id }, angle: { id: r.a_id, campaign_id: r.campaign_id, workspace_id: r.workspace_id, editor_id: r.a_editor },
    v, ws: r.workspace_id, editorId: v?.editor_id || r.a_editor || null };
}
async function loadWs(u, ws, knownRole) {
  // Everything for one workspace in a single parallel batch (role check included).
  const [roleRow, wRows, campaigns, anglesAll, itemsAll, videosAll, commentsAll, people, admins] = await Promise.all([
    knownRole ? Promise.resolve([{ role: knownRole }]) : (u.is_admin ? Promise.resolve([{ role: 'admin' }]) : q('select role from memberships where user_id = $1 and workspace_id = $2', [u.id, ws])),
    q('select * from workspaces where id = $1', [ws]),
    q('select * from campaigns where workspace_id = $1 order by created_at', [ws]),
    q('select * from angles where workspace_id = $1', [ws]),
    q('select * from items where workspace_id = $1', [ws]),
    q('select * from videos where workspace_id = $1', [ws]),
    q('select * from comments where workspace_id = $1 order by at', [ws]),
    q('select u.id, u.name, u.email, (u.pass_hash is null) as invited, m.role from memberships m join users u on u.id = m.user_id where m.workspace_id = $1 order by m.created_at', [ws]),
    q('select id, name from users where is_admin')
  ]);
  const role = roleRow[0]?.role || null;
  if (!role) fail(403, 'forbidden', "You don't have access to this workspace.");
  const w = wRows[0];
  if (!w) fail(404, 'not_found', 'This workspace no longer exists.');
  let angles = anglesAll, items = itemsAll, videos = videosAll, comments = commentsAll;
  if (role === 'editor') {
    const mineByVideo = new Set(videosAll.filter(v => v.editor_id === u.id).map(v => v.angle_id));
    angles = anglesAll.filter(x => x.editor_id === u.id || mineByVideo.has(x.id));
    const ids = new Set(angles.map(x => x.id));
    items = itemsAll.filter(i => ids.has(i.angle_id));
    videos = videosAll.filter(v => ids.has(v.angle_id));
    const keys = new Set(videos.map(v => v.key));
    comments = commentsAll.filter(c => keys.has(c.video_key));
  }
  const ppl = people.map(p => ({ id: p.id, name: p.name, role: p.role, invited: p.invited, email: role === 'admin' ? p.email : undefined }));
  for (const ad of admins) if (!ppl.some(p => p.id === ad.id)) ppl.push({ id: ad.id, name: ad.name, role: 'admin' });
  return {
    role, workspace: { id: w.id, name: w.name, clientCode: w.client_code },
    campaigns: campaigns.map(shape.campaign), angles: angles.map(shape.angle), items: items.map(shape.item),
    videos: videos.map(shape.video), comments: comments.map(shape.comment), people: ppl
  };
}
async function workspacesFor(u) {
  return u.is_admin
    ? (await q('select * from workspaces order by created_at')).map(w => ({ id: w.id, name: w.name, clientCode: w.client_code, role: 'admin' }))
    : (await q('select w.*, m.role from memberships m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.created_at', [u.id]))
        .map(w => ({ id: w.id, name: w.name, clientCode: w.client_code, role: w.role }));
}
function inviteLink(req, token) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}/?invite=${encodeURIComponent(token)}`;
}

/* ---------- routes ---------- */
async function route(req, res, b) {
  const a = b.a;

  /* public */
  if (a === 'login') {
    const email = clean(b.email, 200).toLowerCase();
    const u = (await q('select * from users where email = $1', [email]))[0];
    if (!u || !checkPw(String(b.password || ''), u.pass_hash)) fail(401, 'login', 'Email or password is wrong.');
    setSessionCookie(res, u);
    return { user: shape.user(u) };
  }
  if (a === 'logout') { clearSessionCookie(res); return { ok: true }; }
  if (a === 'invite-info') {
    const u = (await q('select email, name, invite_expires from users where invite_token = $1', [String(b.token || '')]))[0];
    if (!u || Number(u.invite_expires) < now()) fail(404, 'invite', 'This invite link has expired or was already used. Ask the admin for a new one.');
    return { email: u.email, name: u.name };
  }
  if (a === 'accept-invite') {
    const u = (await q('select * from users where invite_token = $1', [String(b.token || '')]))[0];
    if (!u || Number(u.invite_expires) < now()) fail(404, 'invite', 'This invite link has expired or was already used. Ask the admin for a new one.');
    const pw = String(b.password || '');
    if (pw.length < 8) fail(400, 'password', 'Use a password of at least 8 characters.');
    const name = clean(b.name, 80) || u.name;
    const r = await q('update users set pass_hash = $1, name = $2, invite_token = null, invite_expires = null, sess_ver = sess_ver + 1 where id = $3 returning *',
      [hashPw(pw), name, u.id]);
    setSessionCookie(res, r[0]);
    return { user: shape.user(r[0]) };
  }

  const u = await needUser(req);

  if (a === 'me') return { user: shape.user(u), workspaces: await workspacesFor(u) };

  if (a === 'boot') {
    // Login state, workspace list and the chosen workspace's data in one request.
    const workspaces = await workspacesFor(u);
    const pick = workspaces.find(w => w.id === b.ws) || workspaces[0] || null;
    return { user: shape.user(u), workspaces, data: pick ? await loadWs(u, pick.id, pick.role) : null };
  }

  if (a === 'load') return await loadWs(u, String(b.ws || ''));

  /* video work: admin, editor, client */
  if (a === 'video-set') {
    const x = await resolveVideo(b.key);
    const role = await roleIn(u, x.ws);
    if (!role) fail(403, 'forbidden', "You don't have access to this video.");
    const p = b.patch || {};
    const cur = x.v || {};
    const next = {
      editor_id: cur.editor_id ?? null, status: cur.status || 'todo', drive_link: cur.drive_link || '', editor_note: cur.editor_note || '',
      client_note: cur.client_note || '', ready_at: cur.ready_at ?? null, approved_at: cur.approved_at ?? null, reviewed_at: cur.reviewed_at ?? null, reviewed_by: cur.reviewed_by ?? null
    };
    const allowed = role === 'admin' ? ['editorId', 'status', 'driveLink', 'editorNote', 'clientNote']
      : role === 'editor' ? ['status', 'driveLink', 'editorNote'] : ['status', 'clientNote'];
    if (role === 'editor' && x.editorId !== u.id) fail(403, 'forbidden', 'This video is assigned to someone else.');
    for (const k of Object.keys(p)) if (!allowed.includes(k)) fail(403, 'forbidden', "You can't change that.");
    if ('status' in p) {
      const s = String(p.status);
      if (!STATUSES.includes(s)) fail(400, 'bad', 'Unknown status.');
      if (role === 'editor' && !['editing', 'ready'].includes(s)) fail(403, 'forbidden', 'Editors can only start editing or mark ready.');
      if (role === 'client' && !['approved', 'changes'].includes(s)) fail(403, 'forbidden', 'Clients can only approve or request changes.');
      if (role === 'client' && !['ready', 'approved', 'changes'].includes(next.status)) fail(400, 'bad', 'This video is not ready for review yet.');
      if (s === 'ready' && next.status !== 'ready') next.ready_at = now();
      if (s === 'approved' && next.status !== 'approved') next.approved_at = now();
      if ((s === 'approved' || s === 'changes') && role !== 'editor') { next.reviewed_at = now(); next.reviewed_by = u.id; }
      next.status = s;
    }
    if ('driveLink' in p) { const l = clean(p.driveLink, 1000); if (l && !isUrl(l)) fail(400, 'bad', 'Paste a full link that starts with https://'); next.drive_link = l; }
    if ('editorNote' in p) next.editor_note = clean(p.editorNote, 2000);
    if ('clientNote' in p) next.client_note = clean(p.clientNote, 2000);
    if ('editorId' in p) {
      const e = p.editorId ? String(p.editorId) : null;
      if (e) { const m = await q("select 1 from memberships where user_id = $1 and workspace_id = $2 and role = 'editor'", [e, x.ws]); if (!m.length) fail(400, 'bad', 'That editor is not part of this workspace.'); }
      next.editor_id = e;
    }
    await q(`insert into videos(key, workspace_id, campaign_id, angle_id, hook_id, body_id, cta_id, editor_id, status, drive_link, editor_note, client_note, ready_at, approved_at, reviewed_at, reviewed_by, updated_at, updated_by)
             values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             on conflict (key) do update set editor_id=$8, status=$9, drive_link=$10, editor_note=$11, client_note=$12, ready_at=$13, approved_at=$14, reviewed_at=$15, reviewed_by=$16, updated_at=$17, updated_by=$18`,
      [x.key, x.ws, x.angle.campaign_id, x.angle.id, x.h.id, x.b.id, x.c.id, next.editor_id, next.status, next.drive_link, next.editor_note, next.client_note,
       next.ready_at, next.approved_at, next.reviewed_at, next.reviewed_by, now(), u.id]);
    return { ok: true };
  }
  if (a === 'comment-add') {
    const x = await resolveVideo(b.key);
    const role = await roleIn(u, x.ws);
    if (!role) fail(403, 'forbidden', "You don't have access to this video.");
    if (role === 'editor' && x.editorId !== u.id) fail(403, 'forbidden', 'This video is assigned to someone else.');
    const text = clean(b.text, 2000);
    if (!text) fail(400, 'bad', 'Write a comment first.');
    await q('insert into comments(id, workspace_id, video_key, by_user, text, tc, at) values($1,$2,$3,$4,$5,$6,$7)',
      [newId('c_'), x.ws, x.key, u.id, text, clean(b.tc, 8), now()]);
    return { ok: true };
  }
  if (a === 'comment-delete') {
    const c = await one('comments', String(b.id || ''));
    if (c.by_user !== u.id && !u.is_admin) fail(403, 'forbidden', 'You can only delete your own comments.');
    await q('delete from comments where id = $1', [c.id]);
    return { ok: true };
  }

  /* hook shot tick: the client (or admin) marks which hooks have been shot */
  if (a === 'hook-shot') {
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(x => String(x || '')).filter(Boolean).slice(0, 300);
    if (!ids.length) fail(400, 'bad', 'Pick something first.');
    const on = !!b.shot; let n = 0;
    for (const id of ids) {
      const it = (await q("select id, workspace_id from items where id = $1", [id]))[0];
      if (!it) continue;
      const role = await roleIn(u, it.workspace_id);
      if (role !== 'admin' && role !== 'client') fail(403, 'forbidden', 'Only the client or the admin can mark this as shot.');
      await q('update items set shot_at = $1, shot_by = $2 where id = $3', [on ? now() : null, on ? u.id : null, it.id]);
      n++;
    }
    return { ok: true, updated: n };
  }

  /* everything below is admin only */
  needAdmin(u);

  switch (a) {
    case 'ws-create': {
      const name = clean(b.name, 120); if (!name) fail(400, 'bad', 'Give the client a name.');
      const id = newId('w_');
      await q('insert into workspaces(id, name, client_code, created_at) values($1,$2,$3,$4)', [id, name, codeOf(b.clientCode || name, 6), now()]);
      return { id };
    }
    case 'ws-update': {
      const w = await one('workspaces', String(b.ws || ''));
      const name = 'name' in b ? clean(b.name, 120) || w.name : w.name;
      const code = 'clientCode' in b ? codeOf(b.clientCode, 6) : w.client_code;
      await q('update workspaces set name = $1, client_code = $2 where id = $3', [name, code, w.id]);
      return { ok: true };
    }
    case 'campaign-create': {
      const w = await one('workspaces', String(b.ws || ''));
      const name = clean(b.name, 120); if (!name) fail(400, 'bad', 'Give the campaign a name.');
      const drive = clean(b.driveFolder, 1000); if (drive && !isUrl(drive)) fail(400, 'bad', 'The Drive folder link must start with https://');
      const id = newId('k_');
      await q('insert into campaigns(id, workspace_id, name, code, drive_folder, created_at) values($1,$2,$3,$4,$5,$6)',
        [id, w.id, name, codeOf(b.code || name, 8) || 'C1', drive, now()]);
      return { id };
    }
    case 'campaign-update': {
      const c = await one('campaigns', String(b.id || ''));
      const name = 'name' in b ? clean(b.name, 120) || c.name : c.name;
      const code = 'code' in b ? codeOf(b.code, 8) || c.code : c.code;
      let drive = c.drive_folder;
      if ('driveFolder' in b) { drive = clean(b.driveFolder, 1000); if (drive && !isUrl(drive)) fail(400, 'bad', 'The Drive folder link must start with https://'); }
      await q('update campaigns set name = $1, code = $2, drive_folder = $3 where id = $4', [name, code, drive, c.id]);
      return { ok: true };
    }
    case 'campaign-delete': {
      const c = await one('campaigns', String(b.id || ''));
      await deleteVideos('campaign_id = $1', [c.id]);
      await q('delete from items where campaign_id = $1', [c.id]);
      await q('delete from angles where campaign_id = $1', [c.id]);
      await q('delete from campaigns where id = $1', [c.id]);
      return { ok: true };
    }
    case 'angle-create': {
      const c = await one('campaigns', String(b.campaignId || ''));
      const ang = await createAngle(c, String(b.type || 'CUSTOM'), b.name, b.why);
      return { id: ang.id };
    }
    case 'angle-update': {
      const ang = await one('angles', String(b.id || ''));
      let { name, type, code, editor_id } = ang;
      if ('name' in b) name = clean(b.name, 120) || name;
      if ('editorId' in b) {
        editor_id = b.editorId ? String(b.editorId) : null;
        if (editor_id) { const m = await q("select 1 from memberships where user_id = $1 and workspace_id = $2 and role = 'editor'", [editor_id, ang.workspace_id]); if (!m.length) fail(400, 'bad', 'That editor is not part of this workspace.'); }
      }
      if ('type' in b && TYPES.includes(b.type) && b.type !== type) {
        type = b.type;
        const started = (await q('select 1 from videos where angle_id = $1 limit 1', [ang.id])).length;
        if (!started) code = await angleCode(ang.campaign_id, type, name, ang.id);
      }
      await q('update angles set name = $1, type = $2, code = $3, editor_id = $4 where id = $5', [name, type, code, editor_id, ang.id]);
      return { ok: true };
    }
    case 'angle-delete': {
      const ang = await one('angles', String(b.id || ''));
      await deleteVideos('angle_id = $1', [ang.id]);
      await q('delete from items where angle_id = $1', [ang.id]);
      await q('delete from angles where id = $1', [ang.id]);
      return { ok: true };
    }
    case 'items-add': {
      const ang = await one('angles', String(b.angleId || ''));
      return { added: await addItems(ang, String(b.kind), b.texts) };
    }
    case 'video-bulk': {
      const keys = [...new Set((Array.isArray(b.keys) ? b.keys : []).map(k => String(k || '')).filter(Boolean))].slice(0, 500);
      if (!keys.length) fail(400, 'bad', 'Select at least one video first.');
      const e = b.editorId ? String(b.editorId) : null;
      let done = 0;
      for (let i = 0; i < keys.length; i += 10) {
        await Promise.all(keys.slice(i, i + 10).map(async key => {
          const x = await resolveVideo(key);
          if (e) { const m = await q("select 1 from memberships where user_id = $1 and workspace_id = $2 and role = 'editor'", [e, x.ws]); if (!m.length) fail(400, 'bad', 'That editor is not part of this workspace.'); }
          await q(`insert into videos(key, workspace_id, campaign_id, angle_id, hook_id, body_id, cta_id, editor_id, status, drive_link, editor_note, client_note, updated_at, updated_by)
                   values($1,$2,$3,$4,$5,$6,$7,$8,'todo','','','',$9,$10)
                   on conflict (key) do update set editor_id=$8, updated_at=$9, updated_by=$10`,
            [x.key, x.ws, x.angle.campaign_id, x.angle.id, x.h.id, x.b.id, x.c.id, e, now(), u.id]);
          done++;
        }));
      }
      return { ok: true, updated: done };
    }
    case 'item-update': {
      const it = await one('items', String(b.id || ''));
      const text = clean(b.text, 6000); if (!text) fail(400, 'bad', "Text can't be empty.");
      await q('update items set text = $1 where id = $2', [text, it.id]);
      return { ok: true };
    }
    case 'item-delete': {
      const it = await one('items', String(b.id || ''));
      const col = it.kind === 'hooks' ? 'hook_id' : it.kind === 'bodies' ? 'body_id' : 'cta_id';
      await deleteVideos(`${col} = $1`, [it.id]);
      await q('delete from items where id = $1', [it.id]);
      return { ok: true };
    }
    case 'import': {
      const c = await one('campaigns', String(b.campaignId || ''));
      let angles = 0, hooks = 0;
      for (const p of (Array.isArray(b.angles) ? b.angles : []).slice(0, 60)) {
        let ang = null;
        if (p.existingId) { ang = (await q('select * from angles where id = $1 and campaign_id = $2', [String(p.existingId), c.id]))[0] || null; }
        if (!ang) { ang = await createAngle(c, String(p.type || 'CUSTOM').toUpperCase(), p.name, p.why); angles++; }
        hooks += await addItems(ang, 'hooks', p.hooks);
        await addItems(ang, 'bodies', p.bodies);
        await addItems(ang, 'ctas', p.ctas);
      }
      return { angles, hooks };
    }
    case 'team-invite': {
      const w = await one('workspaces', String(b.ws || ''));
      const email = clean(b.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'bad', 'Enter a valid email address.');
      const role = b.role === 'client' ? 'client' : 'editor';
      let user = (await q('select * from users where email = $1', [email]))[0];
      let token = null;
      if (!user) {
        token = newToken();
        const id = newId('u_');
        await q('insert into users(id, email, name, invite_token, invite_expires, created_at) values($1,$2,$3,$4,$5,$6)',
          [id, email, clean(b.name, 80), token, now() + 14 * 864e5, now()]);
        user = { id, is_admin: false };
      } else if (!user.pass_hash) {
        token = newToken();
        await q('update users set invite_token = $1, invite_expires = $2 where id = $3', [token, now() + 14 * 864e5, user.id]);
      }
      if (user.is_admin) fail(400, 'bad', 'That person is already the admin.');
      await q(`insert into memberships(user_id, workspace_id, role, created_at) values($1,$2,$3,$4)
               on conflict (user_id, workspace_id) do update set role = $3`, [user.id, w.id, role, now()]);
      return { link: token ? inviteLink(req, token) : null };
    }
    case 'team-role': {
      const role = b.role === 'client' ? 'client' : 'editor';
      await q('update memberships set role = $1 where user_id = $2 and workspace_id = $3', [role, String(b.userId), String(b.ws)]);
      if (role === 'client') {
        await q('update angles set editor_id = null where editor_id = $1 and workspace_id = $2', [String(b.userId), String(b.ws)]);
        await q('update videos set editor_id = null where editor_id = $1 and workspace_id = $2', [String(b.userId), String(b.ws)]);
      }
      return { ok: true };
    }
    case 'team-remove': {
      await q('delete from memberships where user_id = $1 and workspace_id = $2', [String(b.userId), String(b.ws)]);
      await q('update angles set editor_id = null where editor_id = $1 and workspace_id = $2', [String(b.userId), String(b.ws)]);
      await q('update videos set editor_id = null where editor_id = $1 and workspace_id = $2', [String(b.userId), String(b.ws)]);
      return { ok: true };
    }
    case 'team-link': {
      const target = await one('users', String(b.userId || ''));
      if (target.is_admin) fail(400, 'bad', 'Use your own login.');
      const token = newToken();
      await q('update users set invite_token = $1, invite_expires = $2 where id = $3', [token, now() + 14 * 864e5, target.id]);
      return { link: inviteLink(req, token) };
    }
  }
  fail(400, 'bad', 'Unknown action.');
}
