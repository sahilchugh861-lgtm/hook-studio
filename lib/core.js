import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const db = DB_URL ? neon(DB_URL) : null;
export const q = (text, params = []) => db.query(text, params);
const SECRET = process.env.SESSION_SECRET || '';

export const now = () => Date.now();
export const newId = (p = '') => p + crypto.randomBytes(10).toString('base64url').replace(/[-_]/g, 'x');
export const newToken = () => crypto.randomBytes(24).toString('base64url');

export class HttpErr extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new HttpErr(status, code, message); };

/* ---------- schema ---------- */
const SCHEMA = '3';
let ready = null;
export function migrate() {
  if (!ready) ready = (async () => {
    // Fast path: one query on warm databases instead of ~15 DDL round trips per cold start.
    try {
      const v = await q("select value from settings where key = 'schema'");
      if (v[0]?.value === SCHEMA) return;
    } catch {}
    const stmts = [
      `create table if not exists settings(key text primary key, value text not null)`,
      `create table if not exists users(id text primary key, email text unique not null, name text not null default '', pass_hash text, is_admin boolean not null default false, invite_token text, invite_expires bigint, sess_ver int not null default 1, created_at bigint not null)`,
      `create table if not exists workspaces(id text primary key, name text not null, client_code text not null default '', created_at bigint not null)`,
      `create table if not exists memberships(user_id text not null, workspace_id text not null, role text not null, created_at bigint not null default 0, primary key(user_id, workspace_id))`,
      `create table if not exists campaigns(id text primary key, workspace_id text not null, name text not null, code text not null default '', drive_folder text not null default '', created_at bigint not null)`,
      `create table if not exists angles(id text primary key, workspace_id text not null, campaign_id text not null, type text not null, name text not null, why text not null default '', code text not null, ord int not null default 0, editor_id text, created_at bigint not null)`,
      `create table if not exists items(id text primary key, workspace_id text not null, campaign_id text not null, angle_id text not null, kind text not null, text text not null, n int not null, created_at bigint not null)`,
      `create table if not exists videos(key text primary key, workspace_id text not null, campaign_id text not null, angle_id text not null, hook_id text not null, body_id text not null, cta_id text not null, editor_id text, status text not null default 'todo', drive_link text not null default '', editor_note text not null default '', client_note text not null default '', ready_at bigint, approved_at bigint, reviewed_at bigint, reviewed_by text, updated_at bigint, updated_by text)`,
      `create table if not exists comments(id text primary key, workspace_id text not null, video_key text not null, by_user text not null, text text not null, tc text not null default '', at bigint not null)`,
      `create index if not exists campaigns_ws on campaigns(workspace_id)`,
      `create index if not exists angles_ws on angles(workspace_id)`,
      `create index if not exists items_ws on items(workspace_id)`,
      `create index if not exists videos_ws on videos(workspace_id)`,
      `create index if not exists comments_ws on comments(workspace_id)`,
      `create index if not exists memberships_ws on memberships(workspace_id)`
    ];
    for (const s of stmts) await q(s);
    await q(`alter table items add column if not exists shot_at bigint`);
    await q(`alter table items add column if not exists shot_by text`);
    await q(`create index if not exists items_angle on items(angle_id)`);
    await q(`create index if not exists videos_angle on videos(angle_id)`);
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const setup = process.env.SETUP_TOKEN || '';
    if (adminEmail && setup) {
      const has = await q('select id from users where is_admin limit 1');
      if (!has.length) {
        await q(`insert into users(id,email,name,is_admin,invite_token,invite_expires,created_at) values($1,$2,$3,true,$4,$5,$6)
                 on conflict (email) do update set is_admin = true`,
          [newId('u_'), adminEmail, 'Admin', setup, now() + 60 * 864e5, now()]);
      }
    }
    await q("insert into settings(key, value) values('schema', $1) on conflict (key) do update set value = $1", [SCHEMA]);
  })().catch(e => { ready = null; throw e; });
  return ready;
}

/* ---------- passwords & sessions ---------- */
export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}
export function checkPw(pw, stored) {
  if (!stored || !pw) return false;
  const [s, h] = stored.split(':');
  const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const hb = Buffer.from(h, 'hex');
  return hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
}
function mac(p) { return crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); }
export function signSession(user) {
  const p = Buffer.from(JSON.stringify({ u: user.id, v: user.sess_ver, exp: now() + 30 * 864e5 })).toString('base64url');
  return p + '.' + mac(p);
}
function readSession(tok) {
  if (!tok || !SECRET) return null;
  const [p, m] = tok.split('.');
  if (!p || !m) return null;
  const e = mac(p);
  if (e.length !== m.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(m))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > now() ? o : null; } catch { return null; }
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setSessionCookie(res, user) {
  res.setHeader('Set-Cookie', `hm_s=${signSession(user)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'hm_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}
export async function currentUser(req) {
  const s = readSession(cookies(req).hm_s);
  if (!s) return null;
  const r = await q('select * from users where id = $1', [s.u]);
  const u = r[0];
  if (!u || u.sess_ver !== s.v || !u.pass_hash) return null;
  return u;
}
export function secretsReady() { return !!SECRET; }

/* ---------- shapes ---------- */
export const shape = {
  user: u => ({ id: u.id, name: u.name, email: u.email, isAdmin: u.is_admin }),
  campaign: r => ({ id: r.id, name: r.name, code: r.code, driveFolder: r.drive_folder, createdAt: Number(r.created_at) }),
  angle: r => ({ id: r.id, campaignId: r.campaign_id, type: r.type, name: r.name, why: r.why, code: r.code, order: r.ord, editorId: r.editor_id, createdAt: Number(r.created_at) }),
  item: r => ({ id: r.id, angleId: r.angle_id, campaignId: r.campaign_id, kind: r.kind, text: r.text, n: r.n, createdAt: Number(r.created_at), shotAt: r.shot_at ? Number(r.shot_at) : 0 }),
  video: r => ({ id: r.key, campaignId: r.campaign_id, angleId: r.angle_id, hookId: r.hook_id, bodyId: r.body_id, ctaId: r.cta_id, editorId: r.editor_id, status: r.status, driveLink: r.drive_link, editorNote: r.editor_note, clientNote: r.client_note, readyAt: r.ready_at && Number(r.ready_at), approvedAt: r.approved_at && Number(r.approved_at), reviewedAt: r.reviewed_at && Number(r.reviewed_at), reviewedBy: r.reviewed_by, updatedAt: r.updated_at && Number(r.updated_at) }),
  comment: r => ({ id: r.id, videoKey: r.video_key, by: r.by_user, text: r.text, tc: r.tc, at: Number(r.at) })
};

export const TYPE_CODES = { PAIN: 'PAIN', DESIRE: 'DSR', CURIOSITY: 'CUR', AUTHORITY: 'AUTH', OBJECTION: 'OBJ', STORY: 'STORY', PROOF: 'PROOF', CONTRARIAN: 'CONTRA', CUSTOM: '' };
export const clean = (s, max = 4000) => String(s ?? '').trim().slice(0, max);
export const isUrl = s => /^https:\/\/\S+$/i.test(String(s || '').trim());
export const codeOf = (s, max) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, max);
