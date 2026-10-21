// AI helpers on Claude Haiku: sort a script into angle folders, and write hook variations.
// The API key lives only in the ANTHROPIC_API_KEY env var. Admin only. Monthly spend is capped.
import { db, q, fail, HttpErr, migrate, currentUser, secretsReady, clean } from '../lib/core.js';

const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const PRICE_IN = 0.10, PRICE_OUT = 0.50;          // USD per million tokens (Haiku 5.5, prompts up to 100K tokens)
const LIMIT = Number(process.env.AI_MONTHLY_LIMIT_USD || 5);
const TYPES = ['PAIN', 'DESIRE', 'CURIOSITY', 'AUTHORITY', 'OBJECTION', 'STORY', 'PROOF', 'CONTRARIAN', 'CUSTOM'];
const monthKey = () => 'ai_spend_' + new Date().toISOString().slice(0, 7);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });
  if (!db) return res.status(503).json({ error: 'db_missing', message: 'The database is not connected yet.' });
  if (!secretsReady()) return res.status(503).json({ error: 'config', message: 'The app is missing its session secret.' });
  try {
    await migrate();
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    res.status(200).json(await route(req, b || {}));
  } catch (e) {
    if (e instanceof HttpErr) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error(e);
    res.status(500).json({ error: 'server', message: 'Something went wrong on the server. Try again.' });
  }
}

async function spent() {
  const r = await q('select value from settings where key = $1', [monthKey()]);
  return Number(r[0]?.value || 0);
}
async function addSpend(usd) {
  const total = (await spent()) + usd;
  await q('insert into settings(key, value) values($1, $2) on conflict (key) do update set value = $2', [monthKey(), total.toFixed(6)]);
}

// One call to Claude that must answer through a tool, so the reply is always valid JSON in our shape.
async function claude({ system, user, tool, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail(503, 'ai_off', "AI isn't connected yet. Add the Anthropic API key in Vercel to turn it on.");
  if (await spent() >= LIMIT) fail(429, 'ai_limit', `This month's AI budget ($${LIMIT}) is used up. It resets on the 1st, or raise AI_MONTHLY_LIMIT_USD in Vercel.`);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 55000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: user }] })
    });
  } catch (e) {
    fail(504, 'ai_timeout', 'The AI took too long to answer. Try again.');
  } finally { clearTimeout(timer); }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) {
    console.error('anthropic', r.status, JSON.stringify(j).slice(0, 400));
    if (r.status === 401) fail(502, 'ai_key', 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.');
    if (r.status === 400 && /credit|balance|billing/i.test(JSON.stringify(j))) fail(402, 'ai_credit', 'Your Anthropic account is out of credit. Add credit in the Anthropic Console.');
    if (r.status === 429 || r.status === 529) fail(503, 'ai_busy', 'The AI is busy right now. Try again in a minute.');
    fail(502, 'ai_error', 'The AI could not answer. Try again.');
  }
  const u = j.usage || {};
  const cost = ((u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT) / 1e6;
  await addSpend(cost);
  const out = (j.content || []).find(c => c.type === 'tool_use');
  if (!out) fail(502, 'ai_error', 'The AI answer was empty. Try again.');
  return { input: out.input || {}, cost };
}

const STRATEGIST = 'You are a senior direct-response strategist for Meta video ads in the Indian market. You work with Hinglish, Hindi and English ad scripts.';

async function route(req, b) {
  const u = await currentUser(req);
  if (!u) fail(401, 'auth', 'Please log in again.');
  if (!u.is_admin) fail(403, 'forbidden', 'Only the admin can use AI.');

  if (b.a === 'status') return { ready: !!process.env.ANTHROPIC_API_KEY, spentUsd: await spent(), limitUsd: LIMIT, model: MODEL };

  if (b.a === 'sort') {
    // The browser sends the script already cut into numbered pieces. Claude only answers with piece ids,
    // so it can never change a word of the script.
    const units = (Array.isArray(b.units) ? b.units : []).slice(0, 300).map(x => ({
      id: clean(x.id, 12), kind: ['hook', 'body', 'cta', 'part'].includes(x.kind) ? x.kind : 'part', title: clean(x.title, 120), text: clean(x.text, 6000)
    })).filter(x => x.id && x.text);
    if (!units.length) fail(400, 'bad', 'Nothing to sort. Paste a script first.');
    const total = units.reduce((s, x) => s + x.text.length, 0);
    if (total > 150000) fail(400, 'bad', 'This script is too long for one go. Import it in two parts.');
    const ids = new Set(units.map(x => x.id));
    const labelled = units.some(x => x.kind !== 'part');
    const map = (Array.isArray(b.map) ? b.map : []).slice(0, 50).map(m => `Body ${clean(m.body, 6)} → hooks ${(m.hooks || []).map(h => clean(h, 6)).join(', ')}`);
    const list = units.map(x => `[${x.id}]${x.kind !== 'part' ? ' (' + x.kind + ')' : ''}${x.title ? ' Title: ' + x.title : ''}\n${x.text}`).join('\n\n---\n\n');
    const rules = labelled
      ? `Every piece is already marked as hook, body or cta. Put EVERY hook id in exactly one angle. Attach the body and CTA ids that fit each angle; a body or CTA can go in several angles when it fits them. ${map.length ? 'The script states this hook-to-body mapping, follow it exactly (one angle per body):\n' + map.join('\n') : 'If a body clearly answers a group of hooks, make that body the angle for those hooks.'}`
      : 'The pieces are paragraphs of one or more scripts. Decide which paragraphs are hooks (scroll-stopping openings), bodies (the middle: problem, credibility, proof, solution) and CTAs (the closing ask). Ignore paragraphs that are only notes to the team.';
    const { input, cost } = await claude({
      system: STRATEGIST,
      maxTokens: 4000,
      user: `Sort these script pieces into angle folders for video ad production.\n\n${rules}\n\nAngle types: ${TYPES.join(', ')} (CUSTOM only when none fits). Give each angle a short specific name (max 6 words, same language as the script) and a one-line "why". Use only the ids shown in square brackets. Never invent ids or text.\n\nPIECES:\n\n${list}`,
      tool: {
        name: 'sort_script', description: 'Return the angle folders, using piece ids only.',
        input_schema: { type: 'object', required: ['angles'], properties: { angles: { type: 'array', items: { type: 'object', required: ['type', 'name', 'hooks', 'bodies', 'ctas'], properties: {
          type: { type: 'string', enum: TYPES }, name: { type: 'string' }, why: { type: 'string' },
          hooks: { type: 'array', items: { type: 'string' } }, bodies: { type: 'array', items: { type: 'string' } }, ctas: { type: 'array', items: { type: 'string' } },
          ignored: { type: 'array', items: { type: 'string' }, description: 'Paragraph ids that are only notes, not ad copy' } } } } } }
      }
    });
    const keep = arr => (Array.isArray(arr) ? arr : []).map(String).filter(id => ids.has(id));
    const angles = (Array.isArray(input.angles) ? input.angles : []).slice(0, 40).map(a => ({
      type: TYPES.includes(a.type) ? a.type : 'CUSTOM', name: clean(a.name, 120) || 'Angle', why: clean(a.why, 300),
      hooks: keep(a.hooks), bodies: keep(a.bodies), ctas: keep(a.ctas), ignored: keep(a.ignored)
    }));
    return { angles, costUsd: cost, model: MODEL };
  }

  if (b.a === 'variations') {
    const angle = (await q('select * from angles where id = $1', [String(b.angleId || '')]))[0];
    if (!angle) fail(404, 'not_found', 'That angle folder no longer exists. Refresh the page.');
    const hooks = await q("select id, text, n from items where angle_id = $1 and kind = 'hooks' order by n", [angle.id]);
    const source = b.itemId ? hooks.find(h => h.id === String(b.itemId)) : null;
    if (b.itemId && !source) fail(404, 'not_found', 'That hook no longer exists. Refresh the page.');
    if (!hooks.length) fail(400, 'bad', 'Add at least one hook to this folder first.');
    const ws = (await q('select name from workspaces where id = $1', [angle.workspace_id]))[0] || {};
    let kit = {};
    try { kit = JSON.parse((await q('select data from kit_profiles where workspace_id = $1', [angle.workspace_id]))[0]?.data || '{}'); } catch {}
    const count = Math.max(1, Math.min(10, Number(b.count) || 5));
    const avoid = (Array.isArray(b.avoid) ? b.avoid : []).slice(0, 30).map(s => clean(s, 600));
    const brief = [['About the client', kit.about], ['Target audience', kit.audience], ['Tone & language', kit.tone], ["Do's", kit.dos], ["Don'ts", kit.donts]]
      .filter(([, v]) => v).map(([k, v]) => `${k}: ${clean(v, 1500)}`).join('\n') || 'No client brief saved yet.';
    const { input, cost } = await claude({
      system: STRATEGIST + ' You write scroll-stopping hooks (the first 3 to 5 seconds of a video ad).',
      maxTokens: 2500,
      user: `Client: ${clean(ws.name, 120)}\nAngle folder: ${clean(angle.name, 120)} (${angle.type})${angle.why ? '\nWhy this angle: ' + clean(angle.why, 300) : ''}\n\nCLIENT BRIEF\n${brief}\n\n${source ? `WRITE ${count} NEW HOOKS LIKE THIS ONE (same idea and angle, different words, structure or opening):\n${source.text}` : `WRITE ${count} NEW HOOKS FOR THIS ANGLE.`}\n\nHOOKS ALREADY IN THIS FOLDER (do not repeat or lightly reword these):\n${hooks.map(h => '- ' + clean(h.text, 600)).join('\n')}${avoid.length ? '\n\nALREADY SUGGESTED (also avoid):\n' + avoid.map(s => '- ' + s).join('\n') : ''}\n\nRules:\n- Write in the same language mix and register as the existing hooks (if they are Hinglish in Roman script, write Hinglish in Roman script).\n- Each hook must work as the first spoken lines of a video: 1 to 3 short sentences, about as long as the existing hooks.\n- Follow the brief's do's and don'ts. Do not invent results, numbers, client names or testimonials that are not in the brief or the existing hooks.\n- No hashtags. No emojis unless the existing hooks use them.\n- Make the ${count} hooks clearly different from each other.`,
      tool: { name: 'give_hooks', description: 'Return the new hooks.', input_schema: { type: 'object', required: ['hooks'], properties: { hooks: { type: 'array', items: { type: 'string' } } } } }
    });
    const seen = new Set(hooks.map(h => h.text.trim().toLowerCase()));
    const out = (Array.isArray(input.hooks) ? input.hooks : []).map(s => clean(s, 1200)).filter(s => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase())).slice(0, count);
    return { hooks: out, costUsd: cost, model: MODEL };
  }

  fail(400, 'bad', 'Unknown action.');
}
