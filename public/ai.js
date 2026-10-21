// AI buttons (Claude Haiku): "Sort with AI" in Import, and "✨ Write more hooks" in each angle folder.
// Admin only. Hooks into app.js through window.HS. Talks to /api/ai.
(() => {
const H = () => window.HS;
const A = { status: null, loading: false, sorting: false };
const RUPEE = 85;

async function call(a, data = {}) {
  let r;
  try { r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ a, ...data }) }); }
  catch { const e = new Error('No connection. Check your internet and try again.'); e.status = 0; throw e; }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.message || 'The AI request failed. Try again.'); e.status = r.status; throw e; }
  return j;
}
const isAdmin = () => !!(H().S.me && H().S.me.isAdmin);
function ensureStatus(force) {
  if (!isAdmin() || A.loading || (A.status && !force)) return;
  A.loading = true;
  call('status').then(r => { A.status = r; }).catch(() => { A.status = { ready: false, failed: true }; }).finally(() => { A.loading = false; H().render(); });
}
const rs = usd => '₹' + (usd * RUPEE < 1 ? (usd * RUPEE).toFixed(2) : (usd * RUPEE).toFixed(0));
const offTip = 'AI is not connected yet. Add ANTHROPIC_API_KEY in Vercel to turn it on.';

/* ---------- views ---------- */
function importButton() {
  if (!isAdmin()) return '';
  ensureStatus();
  const off = A.status && !A.status.ready;
  return `<button class="btn ai-btn" data-act="ai-sort" ${A.sorting || off ? 'disabled' : ''} title="${off ? offTip : 'Claude Haiku reads the script and sorts hooks, bodies and CTAs into angle folders. Your words are never changed.'}">${A.sorting ? 'Sorting with AI…' : '✨ Sort with AI'}</button>`;
}
function moreButton(angleId) {
  if (!isAdmin()) return '';
  ensureStatus();
  const off = A.status && !A.status.ready;
  return `<button class="btn sm ghost ai-btn" data-act="ai-vars" data-angle="${H().esc(angleId)}" ${off ? 'disabled' : ''} title="${off ? offTip : 'Write new hooks for this angle with AI'}">✨ Write more</button>`;
}
function modal() {
  const v = H().S.ui.aiVar; if (!v) return '';
  const { esc } = H();
  const opts = [`<option value="" ${!v.itemId ? 'selected' : ''}>All hooks in this folder</option>`]
    .concat(v.hooks.map(h => `<option value="${esc(h.id)}" ${v.itemId === h.id ? 'selected' : ''}>H${h.n} · ${esc(h.text.replace(/\s+/g, ' ').slice(0, 70))}${h.text.length > 70 ? '…' : ''}</option>`)).join('');
  const picked = v.list.filter(x => x.on && x.t.trim()).length;
  const body = v.busy ? `<div class="thinking"><span class="dot"></span>Writing ${v.count} hooks with AI…</div>`
    : v.error ? `<p class="err">${esc(v.error)}</p>`
    : v.list.length ? `<div class="ai-list">${v.list.map((x, i) => `<div class="ai-row"><input type="checkbox" id="av-${i}" data-model="aiVar.list.${i}.on" ${x.on ? 'checked' : ''} aria-label="Use this hook">
        <textarea class="field" id="avt-${i}" data-model="aiVar.list.${i}.t" rows="2" aria-label="Suggested hook ${i + 1}">${esc(x.t)}</textarea></div>`).join('')}</div>
        <p class="muted" style="font-size:.82rem;margin:0">Edit any line before adding. Untick the ones you don't want.${v.cost ? ` This round cost about ${rs(v.cost)}.` : ''}</p>`
    : `<p class="muted">Pick a hook to write variations of, or leave "All hooks in this folder", then click Write.</p>`;
  return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="ai-t" style="width:min(680px,100%)">
    <div class="modal-h"><h2 id="ai-t">✨ New hooks for ${esc(v.angleName)}</h2><button class="btn ghost sm" data-act="ai-close" aria-label="Close">✕</button></div>
    <div class="modal-b">
      <div class="ai-opts"><label class="label" for="ai-src">Write variations of</label>
        <select class="field" id="ai-src" data-model="aiVar.itemId" style="width:100%">${opts}</select>
        <label class="label" for="ai-n">How many</label>
        <select class="field" id="ai-n" data-model="aiVar.count">${[3, 5, 8, 10].map(n => `<option value="${n}" ${Number(v.count) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${body}
    </div>
    <div class="modal-f">${v.list.length && !v.busy ? `<button class="btn" data-act="ai-vars-run" data-more="1">Write ${v.count} more</button><button class="btn primary" data-act="ai-vars-add" ${!picked || v.adding ? 'disabled' : ''}>${v.adding ? 'Adding…' : `Add ${picked} to folder`}</button>`
      : `<button class="btn" data-act="ai-close">Cancel</button><button class="btn primary" data-act="ai-vars-run" ${v.busy ? 'disabled' : ''}>Write ${v.count} hooks</button>`}</div>
  </div></div>`;
}
function settingsNote() {
  if (!isAdmin()) return '';
  ensureStatus();
  const s = A.status;
  if (!s) return '';
  if (!s.ready) return `<div class="note"><b>AI (Claude Haiku): not connected</b><span>Add your Anthropic API key in Vercel as <span class="mono">ANTHROPIC_API_KEY</span> to turn on "Sort with AI" and "Write more" hooks.</span></div>`;
  const pct = s.limitUsd ? Math.min(100, Math.round(s.spentUsd / s.limitUsd * 100)) : 0;
  return `<div class="note"><b>AI (Claude Haiku): connected</b><span>Used this month: about ${rs(s.spentUsd)} of your ${rs(s.limitUsd)} limit (${pct}%). The limit resets on the 1st. Change it with <span class="mono">AI_MONTHLY_LIMIT_USD</span> in Vercel.</span></div>`;
}

/* ---------- actions ---------- */
async function click(a, t) {
  const { S, render, toast } = H(), d = t.dataset;
  switch (a) {
    case 'ai-sort': {
      const im = S.ui.import; if (!im || A.sorting) return;
      if (!String(im.text || '').trim()) { im.error = 'Paste a script first.'; render(); return; }
      const u = window.IMPORTER && window.IMPORTER.units(im.text);
      if (!u) { im.error = "This is already Claude's sorted JSON. Click Review angles."; render(); return; }
      if (!u.units.length) { im.error = 'Nothing to sort. Paste a script first.'; render(); return; }
      A.sorting = true; im.error = ''; render();
      try {
        const r = await call('sort', { units: u.units, map: u.map });
        const cid = S.ui.campaignId, { vals, anglesOf } = H();
        const existing = vals('hooks').filter(h => S.col.angles[h.angleId]?.campaignId === cid).map(h => ({ text: h.text, angle: S.col.angles[h.angleId].name }));
        const res = window.IMPORTER.fromAI(u, r, { existing, angles: anglesOf(cid).map(x => ({ id: x.id, name: x.name })) });
        if (!res.angles.length) { im.error = 'The AI found no hooks in this paste. Check the script and try again.'; }
        else { res.report.notes.unshift(`Sorted by AI (Claude Haiku), cost about ${rs(r.costUsd || 0)}. Your text is copied exactly from the script.`); im.result = res; im.stage = 'review'; }
      } catch (e) { im.error = e.message; if (e.status === 401) H().handleErr(e); }
      A.sorting = false; ensureStatus(true); render(); return;
    }
    case 'ai-vars': {
      const ang = S.col.angles[d.angle]; if (!ang) return;
      const hooks = H().itemsOf('hooks', ang.id);
      S.ui.aiVar = { angleId: ang.id, angleName: ang.name, hooks: hooks.map(h => ({ id: h.id, n: h.n, text: h.text })), itemId: '', count: 5, list: [], busy: false, error: '', cost: 0 };
      render(); return;
    }
    case 'ai-vars-run': {
      const v = S.ui.aiVar; if (!v || v.busy) return;
      const avoid = d.more ? v.list.map(x => x.t) : [];
      v.busy = true; v.error = ''; render();
      try {
        const r = await call('variations', { angleId: v.angleId, itemId: v.itemId || null, count: Number(v.count) || 5, avoid });
        const fresh = r.hooks.map(t => ({ t, on: true }));
        v.list = d.more ? v.list.concat(fresh) : fresh; v.cost = (r.costUsd || 0);
        if (!fresh.length) v.error = 'The AI returned no new hooks. Try again.';
      } catch (e) { v.error = e.message; if (e.status === 401) H().handleErr(e); }
      v.busy = false; ensureStatus(true); render(); return;
    }
    case 'ai-vars-add': {
      const v = S.ui.aiVar; if (!v || v.adding) return;
      const texts = v.list.filter(x => x.on && x.t.trim()).map(x => x.t.trim());
      if (!texts.length) return;
      v.adding = true; render();
      try {
        const r = await H().api('items-add', { angleId: v.angleId, kind: 'hooks', texts });
        await H().load();
        toast(r.added ? `Added ${r.added} hook${r.added === 1 ? '' : 's'} to ${v.angleName}.` : 'Those hooks are already in this folder.');
        S.ui.aiVar = null;
      } catch (e) { v.adding = false; H().handleErr(e); }
      render(); return;
    }
    case 'ai-close': S.ui.aiVar = null; render(); return;
  }
}

const css = `.ai-btn{white-space:nowrap}
.ai-opts{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;align-items:end}
.ai-opts .label:nth-of-type(1){grid-column:1}.ai-opts .label:nth-of-type(2){grid-column:2;grid-row:1}
.ai-list{display:grid;gap:8px}
.ai-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start}
.ai-row input{margin-top:10px}`;
try { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); } catch {}

window.AI = { importButton, moreButton, modal, settingsNote, click };
})();
