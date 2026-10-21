(() => {
const TYPES = [
  {t:'PAIN',label:'Pain',h:2}, {t:'DESIRE',label:'Desire',h:145}, {t:'CURIOSITY',label:'Curiosity',h:268},
  {t:'AUTHORITY',label:'Authority',h:215}, {t:'OBJECTION',label:'Objection',h:28}, {t:'STORY',label:'Story',h:320},
  {t:'PROOF',label:'Proof',h:172}, {t:'CONTRARIAN',label:'Contrarian',h:48}, {t:'CUSTOM',label:'Custom',h:240}
];
const typeOf = t => TYPES.find(x => x.t === t) || TYPES[8];
const STATUS = {
  todo:{l:'To do',c:'s-todo'}, editing:{l:'Editing',c:'s-edit'}, ready:{l:'Ready for review',c:'s-ready'},
  changes:{l:'Changes requested',c:'s-changes'}, approved:{l:'Approved',c:'s-ok'}
};
const STATUS_ORDER = ['changes','editing','todo','ready','approved'];
const KIND = {hooks:{one:'Hook',many:'Hooks',p:'H'}, bodies:{one:'Body',many:'Bodies',p:'B'}, ctas:{one:'CTA',many:'CTAs',p:'C'}};
const EMPTY_COL = () => ({campaigns:{}, angles:{}, hooks:{}, bodies:{}, ctas:{}, videos:{}, comments:{}});

const S = {
  ready:false, me:null, workspaces:[], wsId:null, role:null, meta:{}, col:EMPTY_COL(), people:{}, loaded:false,
  invite:null, bootErr:'',
  ui:{ tab:null, campaignId:null, angleId:null, filter:{status:'all',editor:'all',angle:'all'},
       add:{hooks:'',bodies:'',ctas:''}, newAngle:{type:'PAIN',name:''}, newCampaign:null, newWs:null,
       import:null, armed:null, open:new Set(), note:{}, cdraft:{}, login:{email:'',password:''},
       inv:{name:'',password:'',confirm:''}, teamForm:{name:'',email:'',role:'editor'}, teamLink:null, busy:false, pending:new Set() }
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls = {
  get(k,d){ try{ const v = localStorage.getItem('hms:'+k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k,v){ try{ localStorage.setItem('hms:'+k, JSON.stringify(v)); }catch{} }
};
const now = () => Date.now();
let toastT = 0;
function toast(msg, bad){ const t = document.getElementById('toast'); t.textContent = msg; t.className = 'on' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = bad ? 'bad' : ''; }, 2800); }
function setPath(obj, path, val){ const k = path.split('.'); let o = obj; for(let i=0;i<k.length-1;i++){ if(o[k[i]] == null) o[k[i]] = {}; o = o[k[i]]; } o[k[k.length-1]] = val; }
const isUrl = s => /^https:\/\/\S+$/i.test(String(s||'').trim());

async function api(a, data = {}){
  let r;
  try{ r = await fetch('/api/rpc', {method:'POST', headers:{'content-type':'application/json'}, credentials:'same-origin', body:JSON.stringify({a, ...data})}); }
  catch{ const e = new Error('No connection. Check your internet and try again.'); e.status = 0; throw e; }
  let j = {}; try{ j = await r.json(); }catch{}
  if(!r.ok){ const e = new Error(j.message || 'Request failed. Try again.'); e.code = j.error; e.status = r.status; throw e; }
  return j;
}
function handleErr(e){
  if(e.status === 401 && S.me){ S.me = null; S.workspaces = []; toast('Your session ended. Log in again.', true); render(); return; }
  toast(e.message || 'Something went wrong.', true);
}
let syncT = 0, loadSeq = 0;
function refreshSoon(ms = 400){ clearTimeout(syncT); syncT = setTimeout(() => load().catch(e => { if(e.status === 401) handleErr(e); }), ms); }
// Server-confirmed action (creates need the new id): wait for the server, then sync.
async function W(fn, ok){
  try{ await fn(); await load(); if(ok) toast(ok); return true; }
  catch(e){ handleErr(e); refreshSoon(0); return false; }
}
// Optimistic action: change local state and paint now, save in the background, resync on failure.
async function M(local, remote, ok){
  loadSeq++;
  try{ local(); }catch(err){ console.warn(err); }
  render();
  try{ await remote(); if(ok) toast(ok); refreshSoon(); return true; }
  catch(e){ handleErr(e); refreshSoon(0); return false; }
}
function clearCache(){ try{ Object.keys(localStorage).filter(k => k.startsWith('hms:')).forEach(k => localStorage.removeItem(k)); }catch{} }
async function syncAll(){
  const r = await api('boot', {ws: S.wsId || ls.get('ws', null)});
  S.me = r.user; S.workspaces = r.workspaces; ls.set('boot', {user:r.user, workspaces:r.workspaces});
  if(r.data){ S.wsId = r.data.workspace.id; ls.set('ws', S.wsId); applyData(r.data); }
  else { S.wsId = null; S.loaded = true; }
}
async function refreshMe(){
  const r = await api('me');
  S.me = r.user; S.workspaces = r.workspaces;
  if(!S.workspaces.some(w => w.id === S.wsId)){
    const saved = ls.get('ws', null);
    S.wsId = S.workspaces.some(w => w.id === saved) ? saved : (S.workspaces[0]?.id || null);
  }
}
async function load(){
  if(!S.wsId){ S.loaded = true; return; }
  const seq = ++loadSeq, ws = S.wsId;
  const r = await api('load', {ws});
  if(seq !== loadSeq || ws !== S.wsId) return; // a newer change or load superseded this one
  applyData(r);
}
function applyData(r, fromCache){
  const col = EMPTY_COL();
  for(const c of r.campaigns) col.campaigns[c.id] = c;
  for(const a of r.angles) col.angles[a.id] = a;
  for(const i of r.items) col[i.kind][i.id] = i;
  for(const v of r.videos) col.videos[v.id] = v;
  for(const c of r.comments) col.comments[c.id] = c;
  S.col = col; S.role = r.role;
  S.meta = {clientName:r.workspace.name, clientCode:r.workspace.clientCode};
  S.people = Object.fromEntries(r.people.map(p => [p.id, p]));
  S.loaded = true;
  if(!fromCache) ls.set('cache:' + r.workspace.id, r);
  scheduleRender();
}
function localVideo(key, patch){
  const x = findCombo(key); if(!x) return;
  const cur = S.col.videos[key] || {id:key, campaignId:x.angle.campaignId, angleId:x.angle.id, hookId:x.h.id, bodyId:x.b.id, ctaId:x.c.id, status:'todo'};
  const nx = {...cur, ...patch};
  if(patch.status === 'ready' && cur.status !== 'ready') nx.readyAt = now();
  S.col.videos[key] = nx;
}
function localComment(key, text, tc){
  const id = 'tmp_' + now() + Math.random().toString(36).slice(2, 6);
  S.col.comments[id] = {id, videoKey:key, by:S.me.id, text, tc, at:now()};
}

const vals = c => Object.values(S.col[c]);
const byCreated = (a,b) => (a.createdAt||0) - (b.createdAt||0);
const campaigns = () => vals('campaigns').sort(byCreated);
const curCampaign = () => S.col.campaigns[S.ui.campaignId] || null;
const anglesOf = cid => vals('angles').filter(a => a.campaignId === cid).sort((a,b) => (a.order??0)-(b.order??0) || byCreated(a,b));
const itemsOf = (k, aid) => vals(k).filter(x => x.angleId === aid).sort((a,b) => (a.n||0)-(b.n||0));
function combos(angle){
  const hs = itemsOf('hooks', angle.id), bs = itemsOf('bodies', angle.id), cs = itemsOf('ctas', angle.id);
  const out = [];
  if(!bs.length || !cs.length) return out;
  for(const h of hs) for(const b of bs) for(const c of cs){
    const key = `${h.id}__${b.id}__${c.id}`;
    out.push({key, angle, h, b, c, v:S.col.videos[key] || null});
  }
  return out;
}
const allCombos = cid => cid ? anglesOf(cid).flatMap(combos) : campaigns().flatMap(c => anglesOf(c.id).flatMap(combos));
const statusOf = x => x.v?.status || 'todo';
const editorOf = x => x.v?.editorId || x.angle.editorId || null;
const isDone = s => s === 'ready' || s === 'approved';
function adName(x){
  const cl = (S.meta.clientCode || 'CLIENT').toUpperCase();
  const camp = (S.col.campaigns[x.angle.campaignId]?.code || 'C1').toUpperCase();
  return `${cl}_${camp}_${x.angle.code || 'ANGLE'}_H${x.h.n}_B${x.b.n}_C${x.c.n}`;
}
function nameOf(id){
  if(!id) return 'Unassigned';
  if(S.me && id === S.me.id) return 'You';
  return S.people[id]?.name || 'Team member';
}
const editors = () => Object.values(S.people).filter(p => p.role === 'editor');
const role = () => S.role || S.workspaces.find(w => w.id === S.wsId)?.role || null;
function findCombo(key){
  const [hid, bid, cid] = key.split('__');
  const h = S.col.hooks[hid], b = S.col.bodies[bid], c = S.col.ctas[cid];
  if(!h || !b || !c) return null;
  const angle = S.col.angles[h.angleId];
  if(!angle) return null;
  return {key, angle, h, b, c, v:S.col.videos[key] || null};
}

let raf = 0;
const editable = el => !!(el && el.matches && el.matches('textarea, input:not([type=checkbox]):not([type=radio]), select'));
function scheduleRender(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
// Patch only what changed. Buttons, scroll position and the field being typed in stay put,
// so a click that starts while the page refreshes is never lost.
function render(){
  cancelAnimationFrame(raf);
  const app = document.getElementById('app'), html = view();
  if(!window.morphdom || !app.firstChild){ app.innerHTML = html; return; }
  const next = document.createElement('div'); next.innerHTML = html;
  const active = document.activeElement;
  window.morphdom(app, next, {childrenOnly:true, onBeforeElUpdated(from, to){
    if(from === active && editable(from)) return false;
    return !from.isEqualNode(to);
  }});
}
const pb = k => S.ui.pending.has(k) ? 'disabled aria-busy="true"' : '';

function view(){
  if(!S.ready) return `<div class="gate gut"><div class="gate-card"><div class="thinking"><span class="dot"></span>Opening Hook Studio…</div></div></div>`;
  if(S.invite) return inviteView();
  if(S.bootErr) return gate('Almost ready', S.bootErr);
  if(!S.me) return loginView();
  if(!S.workspaces.length){
    if(S.me.isAdmin) return gate('Add your first client', 'Each client gets their own workspace. Their team only ever sees that workspace.',
      wsForm() + `<div class="ctrls"><button class="btn primary" data-act="save-ws" ${pb('save-ws')}>Create workspace</button><button class="btn ghost" data-act="logout">Log out</button></div>`);
    return gate('No workspace yet', "You're logged in, but the admin hasn't added you to a client workspace yet. Ask them to add you, then refresh this page.",
      `<div class="ctrls"><button class="btn" data-act="reload">Refresh</button><button class="btn ghost" data-act="logout">Log out</button></div>`);
  }
  if(!S.loaded) return `<div class="gate gut"><div class="gate-card"><div class="thinking"><span class="dot"></span>Loading workspace…</div></div></div>`;
  return shell();
}
function gate(title, text, extra=''){
  return `<div class="gate gut"><div class="gate-card"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>${extra}</div></div>`;
}
function loginView(){
  const l = S.ui.login;
  return gate('Log in to Hook Studio', 'Your ad videos, scripts and feedback in one place.',
    `<form data-form="login" style="display:grid;gap:10px">
      <label class="label" for="lg-email">Email</label>
      <input class="field" type="email" id="lg-email" data-model="login.email" value="${esc(l.email)}" autocomplete="email" required>
      <label class="label" for="lg-pw">Password</label>
      <input class="field" type="password" id="lg-pw" data-model="login.password" autocomplete="current-password" required>
      <div class="ctrls"><button class="btn primary" type="submit" ${S.ui.busy?'disabled':''}>${S.ui.busy?'Logging in…':'Log in'}</button></div>
      <p class="muted" style="font-size:.84rem">New here or forgot your password? Ask the admin for a login link.</p>
    </form>`);
}
function inviteView(){
  const iv = S.invite, f = S.ui.inv;
  if(iv.err) return gate('This link no longer works', iv.err, `<div class="ctrls"><a class="btn" href="/">Go to login</a></div>`);
  if(!iv.info) return `<div class="gate gut"><div class="gate-card"><div class="thinking"><span class="dot"></span>Checking your invite…</div></div></div>`;
  return gate('Set up your login', `You're joining as ${iv.info.email}. Choose your name and a password.`,
    `<form data-form="invite" style="display:grid;gap:10px">
      <label class="label" for="iv-name">Your name</label>
      <input class="field" id="iv-name" data-model="inv.name" value="${esc(f.name || iv.info.name || '')}" autocomplete="name" required>
      <label class="label" for="iv-pw">Password (at least 8 characters)</label>
      <input class="field" type="password" id="iv-pw" data-model="inv.password" autocomplete="new-password" minlength="8" required>
      <label class="label" for="iv-pw2">Type it again</label>
      <input class="field" type="password" id="iv-pw2" data-model="inv.confirm" autocomplete="new-password" minlength="8" required>
      <div class="ctrls"><button class="btn primary" type="submit" ${S.ui.busy?'disabled':''}>${S.ui.busy?'Saving…':'Save and open my board'}</button></div>
    </form>`);
}
function wsForm(){
  const n = S.ui.newWs || (S.ui.newWs = {name:'', clientCode:''});
  return `<div style="display:grid;gap:6px"><label class="label" for="nw-name">Client name</label><input class="field" id="nw-name" data-model="newWs.name" value="${esc(n.name)}" placeholder="e.g. Sanjay Nuthra"></div>
    <div style="display:grid;gap:6px"><label class="label" for="nw-code">Client code for ad names (2–6 letters)</label><input class="field mono" id="nw-code" data-model="newWs.clientCode" value="${esc(n.clientCode)}" maxlength="6" placeholder="SNC"></div>`;
}

function tabsFor(r){
  if(r === 'admin') return [['board','Board'],['production','Production'],['dashboard','Dashboard'],['kit','Client kit'],['team','Team'],['settings','Settings']];
  if(r === 'editor') return [['queue','My queue'],['kit','Client kit'],['dashboard','Progress']];
  return [['dashboard','Overview'],['review','Review'],['all','All videos']];
}
function shell(){
  const r = role();
  const tabs = tabsFor(r);
  if(!tabs.some(t => t[0] === S.ui.tab)) S.ui.tab = tabs[0][0];
  const cs = campaigns();
  if(S.ui.campaignId !== '__all' && !S.col.campaigns[S.ui.campaignId]) S.ui.campaignId = cs.length ? cs[cs.length-1].id : null;
  if(S.ui.campaignId === '__all' && r !== 'editor') S.ui.campaignId = cs.length ? cs[cs.length-1].id : null;
  const roleLabel = {admin:'Admin', editor:'Editor', client:'Client'}[r] || '';
  const wsSel = (S.workspaces.length > 1 || S.me.isAdmin) ? `<select class="field" id="ws-sel" data-chg="ws" aria-label="Client workspace">
      ${S.workspaces.map(w => `<option value="${esc(w.id)}" ${w.id===S.wsId?'selected':''}>${esc(w.name)}</option>`).join('')}</select>
      ${S.me.isAdmin ? `<button class="btn sm ghost" data-act="new-ws">+ Client</button>` : ''}` : '';
  const campSel = cs.length ? `<select class="field" id="camp-sel" data-chg="campaign" aria-label="Campaign">
      ${r === 'editor' ? `<option value="__all" ${S.ui.campaignId==='__all'?'selected':''}>All campaigns</option>` : ''}
      ${cs.map(c => `<option value="${esc(c.id)}" ${c.id===S.ui.campaignId?'selected':''}>${esc(c.name)}</option>`).join('')}
    </select>` : '';
  return `
  <header class="top"><div class="top-in gut">
    <div class="brand"><img class="mark" src="/op.svg?v=4" alt="OccultPreneur" width="34" height="18"><div style="min-width:0"><div class="ws">${esc(S.meta.clientName || 'Workspace')}</div><div class="sub">Hook Studio · ${roleLabel}</div></div></div>
    <div class="camp">${wsSel}${campSel}${r==='admin' ? `<button class="btn sm ghost" data-act="new-campaign">+ Campaign</button>` : ''}</div>
    <nav class="tabs" aria-label="Sections">${tabs.map(([k,l]) => `<button class="tab" data-act="tab" data-tab="${k}" ${S.ui.tab===k?'aria-current="page"':''}>${l}</button>`).join('')}</nav>
    <div class="userchip"><span>${esc(S.me.name || S.me.email)}</span><button class="btn sm ghost" data-act="logout">Log out</button></div>
  </div></header>
  <main class="wrap gut">${page(r)}</main>
  ${S.ui.newCampaign ? campaignModal() : ''}
  ${S.ui.newWs && S.ui.newWsOpen ? wsModal() : ''}
  ${S.ui.import ? importModal() : ''}
  ${window.AI ? window.AI.modal() : ''}`;
}
function page(r){
  const t = S.ui.tab;
  if(r === 'admin' && t === 'team') return teamView();
  if(r === 'admin' && t === 'settings') return settingsView();
  if(t === 'kit' && r !== 'client') return window.KIT ? window.KIT.view(r) : '';
  if(!campaigns().length) return noCampaigns(r);
  if(t === 'board') return boardView();
  if(t === 'production') return productionView();
  if(t === 'dashboard') return dashboardView(r);
  if(t === 'queue') return queueView();
  if(t === 'review') return reviewView();
  if(t === 'all') return allView();
  return '';
}
function noCampaigns(r){
  if(r !== 'admin') return `<div class="empty"><h2>No campaigns yet</h2><p>When the admin adds a campaign, its videos will show up here.</p></div>`;
  return `<div class="empty"><h2>Start with a campaign</h2>
    <p>A campaign is one batch of ads, like "October batch". Inside it you'll paste scripts, Hook Studio sorts the hooks into angle folders and lines up every video to edit.</p>
    <button class="btn primary" data-act="new-campaign">Create first campaign</button></div>`;
}

function boardView(){
  const cid = S.ui.campaignId;
  const angles = anglesOf(cid);
  if(!S.col.angles[S.ui.angleId] || S.col.angles[S.ui.angleId].campaignId !== cid) S.ui.angleId = angles[0]?.id || null;
  const na = S.ui.newAngle;
  const rail = `<aside class="rail">
    <div class="rail-h"><h2>Angles</h2><button class="btn sm primary" data-act="import-open">Import script</button></div>
    <div class="folders">${angles.map(a => {
      const cb = combos(a), done = cb.filter(x => isDone(statusOf(x))).length, hooks = itemsOf('hooks', a.id).length;
      const pct = cb.length ? Math.round(done / cb.length * 100) : 0;
      return `<button class="folder" data-act="angle" data-id="${esc(a.id)}" aria-current="${a.id===S.ui.angleId}">
        <span class="folder-top"><span class="chip" style="--h:${typeOf(a.type).h}">${esc(typeOf(a.type).label)}</span><span class="mono muted">${esc(a.code)}</span></span>
        <span class="folder-name">${esc(a.name)}</span>
        <span class="folder-meta"><span>${hooks} hook${hooks===1?'':'s'}</span><span>${done}/${cb.length} videos</span></span>
        <span class="bar"><i style="width:${pct}%"></i></span></button>`;
    }).join('') || `<p class="muted">No angles yet. Import a script or add one below.</p>`}</div>
    <div class="addangle"><span class="label">New angle</span>
      <div class="row"><select class="field" id="na-type" data-model="newAngle.type" aria-label="Angle type">${TYPES.map(t => `<option value="${t.t}" ${na.type===t.t?'selected':''}>${t.label}</option>`).join('')}</select>
      <input class="field" id="na-name" data-model="newAngle.name" value="${esc(na.name)}" placeholder="Angle name"></div>
      <button class="btn sm" data-act="add-angle" ${pb('add-angle')}>Add angle folder</button></div>
  </aside>`;
  const a = S.col.angles[S.ui.angleId];
  const bench = a ? angleBench(a) : `<div class="empty"><h2>Paste your first script</h2>
    <p>Click <b>Import script</b>. Paste the sorted script from Claude, or a simple list with ANGLE, HOOK, BODY and CTA lines. Each angle becomes a folder and every hook lines up as a video.</p>
    <button class="btn primary" data-act="import-open">Import script</button></div>`;
  return `<div class="board">${rail}<section class="bench">${bench}</section></div>`;
}
function angleBench(a){
  const t = typeOf(a.type);
  const eds = editors();
  const armed = S.ui.armed === 'angle:' + a.id;
  const hs = itemsOf('hooks', a.id), bs = itemsOf('bodies', a.id), cs = itemsOf('ctas', a.id);
  const cb = combos(a);
  const done = cb.filter(x => isDone(statusOf(x))).length;
  const part = kind => {
    const list = itemsOf(kind, a.id), K = KIND[kind];
    return `<div class="part"><div class="part-h"><h3>${K.many}</h3>${kind === 'hooks' && window.AI ? window.AI.moreButton(a.id) : ''}<span class="label">${list.length}</span></div>
      <div class="items">${list.map(i => `<div class="item"><span class="code">${K.p}${i.n}</span>
        <textarea class="field flat" id="it-${esc(i.id)}" data-blur="item" data-kind="${kind}" data-id="${esc(i.id)}" rows="${kind==='bodies'?4:2}" aria-label="${K.one} ${K.p}${i.n}">${esc(i.text)}</textarea>
        <button class="btn sm ghost ${S.ui.armed==='item:'+i.id?'danger armed':''}" data-act="del-item" data-id="${esc(i.id)}" title="Delete ${K.one}">${S.ui.armed==='item:'+i.id?'Confirm':'✕'}</button></div>`).join('')
        || `<p class="muted">${kind==='hooks' ? 'No hooks yet.' : `Add a ${K.one.toLowerCase()} to turn hooks into videos.`}</p>`}</div>
      <div class="adder"><textarea class="field" id="add-${kind}" data-model="add.${kind}" rows="${kind==='bodies'?3:2}" placeholder="${kind==='hooks' ? 'Paste hooks, one per line' : `Paste a ${K.one.toLowerCase()}`}">${esc(S.ui.add[kind])}</textarea>
      <button class="btn sm" data-act="add-items" data-kind="${kind}" ${pb('add-items' + kind)}>Add ${kind==='hooks' ? 'hooks' : K.one.toLowerCase()}</button></div></div>`;
  };
  return `<div class="panel">
    <div class="bench-h">
      <span class="chip" style="--h:${t.h}">${esc(t.label)}</span>
      <input class="field flat angle-name" id="an-${esc(a.id)}" data-blur="angle-name" data-id="${esc(a.id)}" value="${esc(a.name)}" aria-label="Angle name">
      <span class="mono muted" title="Angle code used in ad names">${esc(a.code)}</span>
      <select class="field" id="at-${esc(a.id)}" data-chg="angle-type" data-id="${esc(a.id)}" aria-label="Angle type">${TYPES.map(x => `<option value="${x.t}" ${x.t===a.type?'selected':''}>${x.label}</option>`).join('')}</select>
      <label class="ctrls" style="gap:6px"><span class="label">Editor</span><select class="field" id="ae-${esc(a.id)}" data-chg="angle-editor" data-id="${esc(a.id)}">
        <option value="">Unassigned</option>${eds.map(e => `<option value="${esc(e.id)}" ${a.editorId===e.id?'selected':''}>${esc(nameOf(e.id))}</option>`).join('')}</select></label>
      <button class="btn sm danger ${armed?'armed':''}" data-act="del-angle" data-id="${esc(a.id)}">${armed ? 'Confirm delete' : 'Delete angle'}</button>
    </div>
    ${a.why ? `<p class="why">${esc(a.why)}</p>` : ''}
    <div class="parts">${part('hooks')}${part('bodies')}${part('ctas')}</div>
  </div>
  <div class="panel">
    <div class="sec-h"><div><h2>Videos from this angle</h2>
      <div class="formula"><b>${hs.length}</b> hooks × <b>${bs.length}</b> ${bs.length===1?'body':'bodies'} × <b>${cs.length}</b> CTA${cs.length===1?'':'s'} <span class="eq">= ${cb.length} videos</span> · ${done} done</div></div></div>
    <div class="rows">${cb.length ? cb.map(x => videoRow(x, perms('admin', x))).join('') : `<div class="vrow"><span></span><p class="muted">${!hs.length ? 'Add hooks to start.' : 'Add at least one body and one CTA. Each hook then becomes a video ready to edit.'}</p></div>`}</div>
  </div>`;
}

function perms(r, x){
  if(r === 'admin') return {work:true, assign:true, approve:true, tick:true};
  if(r === 'editor'){ const mine = editorOf(x) === S.me.id; return {work:mine, assign:false, approve:false, tick:mine}; }
  return {work:false, assign:false, approve:true, tick:false};
}
function pill(s){ const st = STATUS[s] || STATUS.todo; return `<span class="pill ${st.c}">${st.l}</span>`; }
function videoRow(x, p){
  const s = statusOf(x), key = 'v:' + x.key, open = S.ui.open.has(key);
  const nc = commentsOf(x.key).length;
  return `<div class="vrow">
    <input type="checkbox" class="tick" id="tk-${esc(x.key)}" data-chg="tick" data-key="${esc(x.key)}" ${isDone(s)?'checked':''} ${p.tick?'':'disabled'} aria-label="Mark ${esc(adName(x))} done">
    <details data-key="${esc(key)}" ${open?'open':''}>
      <summary><span class="vcode">${esc(adName(x))}</span><span class="vhook">${esc(x.h.text)}</span>${pill(s)}<span class="who">${esc(nameOf(editorOf(x)))}${x.v?.driveLink ? ' · ▶ video' : ''}${nc ? ' · 💬 ' + nc : ''}</span></summary>
      <div class="vbody">${videoDetail(x, p)}</div>
    </details></div>`;
}
function videoCard(x, p){
  const s = statusOf(x);
  return `<article class="vcard"><div class="vcard-h">
      ${p.tick ? `<input type="checkbox" class="tick" style="margin:0" id="tc-${esc(x.key)}" data-chg="tick" data-key="${esc(x.key)}" ${isDone(s)?'checked':''} aria-label="Mark done">` : ''}
      <span class="chip" style="--h:${typeOf(x.angle.type).h}">${esc(typeOf(x.angle.type).label)}</span>
      <span class="vcode">${esc(adName(x))}</span>${pill(s)}
      <span class="muted" style="margin-left:auto;font-size:.82rem">${esc(x.angle.name)}${S.ui.campaignId==='__all' ? ' · ' + esc(S.col.campaigns[x.angle.campaignId]?.name || '') : ''}</span>
    </div><div class="vcard-b">${videoDetail(x, p)}</div></article>`;
}
function videoSlot(x, p){
  const v = x.v || {}, camp = S.col.campaigns[x.angle.campaignId] || {}, k = esc(x.key);
  if(p.work){
    return `<div class="slot ${v.driveLink ? 'has' : ''}">
      <div class="slot-h"><span class="label">Final video</span>${v.driveLink ? `<a class="btn sm primary" href="${esc(v.driveLink)}" target="_blank" rel="noopener">▶ Watch ↗</a>` : ''}</div>
      <ol class="slot-steps">
        <li>${camp.driveFolder ? `<a href="${esc(camp.driveFolder)}" target="_blank" rel="noopener">Open the upload folder ↗</a> and upload the edited video.` : 'Upload the edited video to Google Drive (or any Drive) and set sharing to "Anyone with the link can view".'}</li>
        <li><label for="dl-${k}">Paste the video's share link here:</label>
          <input class="field" type="url" id="dl-${k}" data-blur="drive" data-key="${k}" value="${esc(v.driveLink||'')}" placeholder="https://drive.google.com/file/d/…"></li>
        <li>Click <b>Mark ready for review</b> below. The admin gets an email and the client can watch it.</li>
      </ol></div>`;
  }
  if(v.driveLink) return `<div class="slot has"><div class="slot-h"><span class="label">Final video</span></div>
    <a class="btn primary watch" href="${esc(v.driveLink)}" target="_blank" rel="noopener">▶ Watch video on Drive ↗</a>
    <p class="muted" style="font-size:.82rem">Opens in a new tab. Watch it, then leave your comments below.</p></div>`;
  return `<div class="slot"><div class="slot-h"><span class="label">Final video</span></div><p class="muted">The editor hasn't added the video yet.</p></div>`;
}
function commentsOf(key){ return vals('comments').filter(c => c.videoKey === key).sort((a,b) => (a.at||0)-(b.at||0)); }
function ago(t){ if(!t) return ''; const s = Math.round((now()-t)/1000); if(s < 60) return 'just now'; const m = Math.round(s/60); if(m < 60) return m + ' min ago'; const h = Math.round(m/60); if(h < 24) return h + ' h ago'; return new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short'}); }
function commentThread(x, p){
  const k = esc(x.key), list = commentsOf(x.key), draft = S.ui.cdraft[x.key] || {text:'', tc:''};
  const canPost = role() !== 'editor' || p.work;
  return `<div class="thread"><div class="slot-h"><span class="label">Comments · ${list.length}</span></div>
    ${list.map(c => { const r = S.people[c.by]?.role || ''; const mine = S.me && c.by === S.me.id;
      return `<div class="cmt"><div class="cmt-h"><b>${esc(nameOf(c.by))}</b>${r ? `<span class="rtag r-${r}">${r}</span>` : ''}<span class="muted">${esc(ago(c.at))}</span>
        ${mine || role()==='admin' ? `<button class="btn ghost sm ${S.ui.armed==='cmt:'+c.id?'danger armed':''}" style="margin-left:auto" data-act="del-comment" data-id="${esc(c.id)}">${S.ui.armed==='cmt:'+c.id?'Confirm':'Delete'}</button>` : ''}</div>
        <p>${c.tc ? `<span class="tc">${esc(c.tc)}</span>` : ''}${esc(c.text)}</p></div>`; }).join('') || `<p class="muted" style="font-size:.86rem">No comments yet. Add the exact moment (like 0:12) so the editor knows where to change.</p>`}
    ${canPost ? `<div class="cmt-new">
      <input class="field mono" id="ct-${k}" data-model="cdraft.${k}.tc" value="${esc(draft.tc)}" placeholder="0:12" maxlength="8" aria-label="Time in video (optional)">
      <textarea class="field" id="cx-${k}" data-model="cdraft.${k}.text" rows="1" placeholder="Write a comment">${esc(draft.text)}</textarea>
      <button class="btn sm" data-act="post-comment" data-key="${k}">Post</button>
    </div>` : ''}</div>`;
}
function videoDetail(x, p){
  const v = x.v || {}, s = statusOf(x);
  const eds = editors();
  const note = S.ui.note[x.key] ?? '';
  const parts = [];
  parts.push(videoSlot(x, p));
  parts.push(`<details class="scriptbox" data-key="${esc('s:' + x.key)}" ${S.ui.open.has('s:' + x.key) || (p.work && role() === 'editor') ? 'open' : ''}><summary class="label">Script</summary><div class="script">
    <div class="sline hook"><span class="label">Hook H${x.h.n}</span><p>${esc(x.h.text)}</p></div>
    <div class="sline"><span class="label">Body B${x.b.n}</span><p>${esc(x.b.text)}</p></div>
    <div class="sline"><span class="label">CTA C${x.c.n}</span><p>${esc(x.c.text)}</p></div></div>
    <div class="ctrls" style="margin-top:10px"><button class="btn sm" data-act="copy-script" data-key="${esc(x.key)}">Copy script</button><button class="btn sm" data-act="copy-name" data-key="${esc(x.key)}">Copy ad name</button></div></details>`);
  if(p.work){
    parts.push(`<div style="display:grid;gap:6px"><label class="label" for="en-${esc(x.key)}">Editor note</label>
        <textarea class="field" id="en-${esc(x.key)}" data-blur="enote" data-key="${esc(x.key)}" rows="1" placeholder="Anything the admin or client should know">${esc(v.editorNote||'')}</textarea></div>`);
  } else if(v.editorNote){
    parts.push(`<p class="muted" style="font-size:.88rem"><b>Editor note:</b> ${esc(v.editorNote)}</p>`);
  }
  if(v.clientNote && s === 'changes') parts.push(`<div class="feedback"><b>Client asked for changes:</b> ${esc(v.clientNote)}</div>`);
  if(v.clientNote && s === 'approved') parts.push(`<div class="feedback ok"><b>Approved.</b> ${esc(v.clientNote)}</div>`);
  const ctl = [];
  if(p.assign){
    ctl.push(`<label class="ctrls" style="gap:6px"><span class="label">Editor</span><select class="field" id="ve-${esc(x.key)}" data-chg="video-editor" data-key="${esc(x.key)}">
      <option value="" ${!v.editorId?'selected':''}>${x.angle.editorId ? 'Angle default (' + esc(nameOf(x.angle.editorId)) + ')' : 'Unassigned'}</option>
      ${eds.map(e => `<option value="${esc(e.id)}" ${v.editorId===e.id?'selected':''}>${esc(nameOf(e.id))}</option>`).join('')}</select></label>`);
    ctl.push(`<label class="ctrls" style="gap:6px"><span class="label">Status</span><select class="field" id="vs-${esc(x.key)}" data-chg="video-status" data-key="${esc(x.key)}">
      ${Object.entries(STATUS).map(([k,o]) => `<option value="${k}" ${k===s?'selected':''}>${o.l}</option>`).join('')}</select></label>`);
  } else if(p.work){
    if(s === 'todo' || s === 'changes') ctl.push(`<button class="btn sm" data-act="status" data-s="editing" data-key="${esc(x.key)}">Start editing</button>`);
    if(s !== 'ready' && s !== 'approved') ctl.push(`<button class="btn sm ok" data-act="status" data-s="ready" data-key="${esc(x.key)}">✓ Mark ready for review</button>`);
    if(s === 'ready') ctl.push(`<span class="muted">Waiting for client review.</span>`);
  }
  if(ctl.length) parts.push(`<div class="ctrls">${ctl.join('')}</div>`);
  if(role() === 'client' && (s === 'ready' || s === 'approved' || s === 'changes')){
    parts.push(`<div style="display:grid;gap:6px"><label class="label" for="cn-${esc(x.key)}">Your decision (feedback needed if you request changes)</label>
      <textarea class="field" id="cn-${esc(x.key)}" data-model="note.${esc(x.key)}" rows="1" placeholder="e.g. Hook text on screen is too small">${esc(note)}</textarea>
      <div class="ctrls">${s !== 'approved' ? `<button class="btn sm ok" data-act="approve" data-key="${esc(x.key)}">Approve</button>` : ''}<button class="btn sm" data-act="changes" data-key="${esc(x.key)}">Request changes</button></div></div>`);
  }
  parts.push(commentThread(x, p));
  return parts.join('');
}

function productionView(){
  const cid = S.ui.campaignId, f = S.ui.filter;
  let list = allCombos(cid);
  const total = list.length;
  if(f.status !== 'all') list = list.filter(x => statusOf(x) === f.status);
  if(f.editor !== 'all') list = list.filter(x => (editorOf(x) || '') === (f.editor === 'none' ? '' : f.editor));
  if(f.angle !== 'all') list = list.filter(x => x.angle.id === f.angle);
  const eds = editors();
  return `<div class="page-h"><div><h1>Production</h1><p>Every video in ${esc(curCampaign()?.name || 'this campaign')}. Tick a video once it's edited, or open it to assign an editor and add the Drive link.</p></div>
    <button class="btn" data-act="export">Export CSV for Ads Manager</button></div>
  <div class="panel"><div class="sec-h"><div class="filters">
    <select class="field" id="f-status" data-chg="filter" data-f="status" aria-label="Filter by status"><option value="all">All statuses</option>${Object.entries(STATUS).map(([k,o]) => `<option value="${k}" ${f.status===k?'selected':''}>${o.l}</option>`).join('')}</select>
    <select class="field" id="f-editor" data-chg="filter" data-f="editor" aria-label="Filter by editor"><option value="all">All editors</option><option value="none" ${f.editor==='none'?'selected':''}>Unassigned</option>${eds.map(e => `<option value="${esc(e.id)}" ${f.editor===e.id?'selected':''}>${esc(nameOf(e.id))}</option>`).join('')}</select>
    <select class="field" id="f-angle" data-chg="filter" data-f="angle" aria-label="Filter by angle"><option value="all">All angles</option>${anglesOf(cid).map(a => `<option value="${esc(a.id)}" ${f.angle===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select>
    </div><span class="muted mono">${list.length} of ${total}</span></div>
    <div class="rows">${list.map(x => videoRow(x, perms('admin', x))).join('') || `<div class="vrow"><span></span><p class="muted">No videos match these filters.</p></div>`}</div></div>`;
}

function queueView(){
  const cid = S.ui.campaignId === '__all' ? null : S.ui.campaignId;
  const mine = allCombos(cid).filter(x => editorOf(x) === S.me.id);
  const kit = window.KIT ? window.KIT.strip() : '';
  if(!mine.length) return kit + `<div class="empty"><h2>Nothing assigned to you yet</h2><p>When the admin assigns you videos, each one appears here with its full script, the upload folder and a place to paste your Drive link.</p></div>`;
  const groups = STATUS_ORDER.map(s => [s, mine.filter(x => statusOf(x) === s)]).filter(g => g[1].length);
  const done = mine.filter(x => isDone(statusOf(x))).length;
  return kit + `<div class="page-h"><div><h1>My queue</h1><p>${done} of ${mine.length} videos done. Edit, upload to Drive, paste the link, then mark it ready for review.</p></div></div>
    <div class="stack">${groups.map(([s, xs]) => `<section><div class="group-h">${pill(s)}<span class="muted mono">${xs.length}</span></div>
      <div class="cards">${xs.map(x => videoCard(x, perms('editor', x))).join('')}</div></section>`).join('')}</div>`;
}

function reviewView(){
  const xs = allCombos(S.ui.campaignId).filter(x => statusOf(x) === 'ready');
  return `<div class="page-h"><div><h1>Ready for your review</h1><p>Watch each video on Drive, then approve it or tell the team what to change.</p></div></div>
  ${xs.length ? `<div class="cards">${xs.map(x => videoCard(x, perms('client', x))).join('')}</div>` : `<div class="empty"><h2>You're all caught up</h2><p>New videos appear here as soon as an editor marks them ready.</p></div>`}`;
}
function allView(){
  const xs = allCombos(S.ui.campaignId);
  return `<div class="page-h"><div><h1>All videos</h1><p>Every planned video in this campaign, with its script and status.</p></div><button class="btn" data-act="export">Export CSV</button></div>
  <div class="panel"><div class="rows">${xs.map(x => videoRow(x, perms('client', x))).join('') || `<div class="vrow"><span></span><p class="muted">No videos planned yet.</p></div>`}</div></div>`;
}

function counts(xs){ const c = {todo:0,editing:0,ready:0,changes:0,approved:0}; for(const x of xs) c[statusOf(x)]++; return c; }
function dashboardView(r){
  const cid = r === 'editor' && S.ui.campaignId === '__all' ? null : S.ui.campaignId;
  let xs = allCombos(cid);
  if(r === 'editor') xs = xs.filter(x => editorOf(x) === S.me.id);
  const c = counts(xs), total = xs.length, done = c.ready + c.approved;
  const pct = n => total ? (n / total * 100) : 0;
  const seg = [['approved','var(--ok)','Approved'],['ready','var(--mari)','Ready for review'],['editing','var(--info)','Editing'],['changes','var(--bad)','Changes requested'],['todo','var(--line)','To do']];
  const angles = cid ? anglesOf(cid) : campaigns().flatMap(cp => anglesOf(cp.id));
  const angleRows = angles.map(a => {
    let cb = combos(a); if(r === 'editor') cb = cb.filter(x => editorOf(x) === S.me.id);
    if(r === 'editor' && !cb.length) return '';
    const d = cb.filter(x => isDone(statusOf(x))).length, ap = cb.filter(x => statusOf(x) === 'approved').length;
    const p = cb.length ? Math.round(d / cb.length * 100) : 0;
    return `<tr><td><span class="chip" style="--h:${typeOf(a.type).h}">${esc(typeOf(a.type).label)}</span></td><td>${esc(a.name)}</td>
      <td class="num">${itemsOf('hooks', a.id).length}</td><td class="num">${cb.length}</td><td class="num">${d}</td><td class="num">${ap}</td>
      <td class="minibar"><div class="bar"><i style="width:${p}%"></i></div></td></tr>`;
  }).join('');
  let edTable = '';
  if(r === 'admin'){
    const byEd = {};
    for(const x of xs){ const e = editorOf(x) || ''; (byEd[e] ||= []).push(x); }
    edTable = `<div class="panel"><div class="sec-h"><h2>Editor workload</h2></div><div class="tbl-wrap"><table>
      <thead><tr><th>Editor</th><th class="num">Assigned</th><th class="num">To do</th><th class="num">Editing</th><th class="num">Changes</th><th class="num">Done</th></tr></thead><tbody>
      ${Object.entries(byEd).map(([e, l]) => { const k = counts(l); return `<tr><td>${esc(e ? nameOf(e) : 'Unassigned')}</td><td class="num">${l.length}</td><td class="num">${k.todo}</td><td class="num">${k.editing}</td><td class="num">${k.changes}</td><td class="num">${k.ready + k.approved}</td></tr>`; }).join('') || `<tr><td colspan="6" class="muted">No videos yet.</td></tr>`}
      </tbody></table></div></div>`;
  }
  const title = r === 'editor' ? 'My progress' : r === 'client' ? 'Campaign overview' : 'Dashboard';
  return `<div class="page-h"><div><h1>${title}</h1><p>${r==='client' ? 'Where your ad videos stand right now.' : `${done} of ${total} videos edited.`}</p></div></div>
  <div class="stack">
    <div class="tiles">
      <div class="tile"><span class="n">${total}</span><span class="t">Videos planned</span></div>
      <div class="tile hl"><span class="n">${done}</span><span class="t">Edited (ready + approved)</span></div>
      <div class="tile"><span class="n">${c.approved}</span><span class="t">Approved</span></div>
      <div class="tile"><span class="n">${c.editing}</span><span class="t">In editing</span></div>
      <div class="tile"><span class="n">${c.changes}</span><span class="t">Changes requested</span></div>
    </div>
    <div class="panel" style="padding:16px;display:grid;gap:10px">
      <div class="bigbar">${seg.map(([k,col]) => c[k] ? `<i style="width:${pct(c[k])}%;background:${col}" title="${STATUS[k].l}: ${c[k]}"></i>` : '').join('')}</div>
      <div class="legend">${seg.map(([k,col,l]) => `<span style="--c:${col}">${l} · ${c[k]}</span>`).join('')}</div>
    </div>
    <div class="panel"><div class="sec-h"><h2>By angle</h2></div><div class="tbl-wrap"><table>
      <thead><tr><th>Type</th><th>Angle</th><th class="num">Hooks</th><th class="num">Videos</th><th class="num">Edited</th><th class="num">Approved</th><th>Progress</th></tr></thead>
      <tbody>${angleRows || `<tr><td colspan="7" class="muted">No angles yet.</td></tr>`}</tbody></table></div></div>
    ${edTable}
  </div>`;
}

function teamView(){
  const ps = Object.values(S.people).filter(p => p.role !== 'admin');
  const f = S.ui.teamForm, link = S.ui.teamLink;
  const wa = link ? 'https://wa.me/?text=' + encodeURIComponent(`Hi ${link.name || ''}, here is your login link for the ${S.meta.clientName} ad videos board: ${link.url}`) : '';
  return `<div class="page-h"><div><h1>Team for ${esc(S.meta.clientName)}</h1><p>Add editors and the client here. They only ever see this client's workspace.</p></div></div>
  <div class="stack">
    <div class="panel" style="padding:16px;display:grid;gap:12px">
      <h2>Add a person</h2>
      <div class="grid3">
        <div style="display:grid;gap:6px"><label class="label" for="tf-name">Name</label><input class="field" id="tf-name" data-model="teamForm.name" value="${esc(f.name)}" placeholder="e.g. Rahul"></div>
        <div style="display:grid;gap:6px"><label class="label" for="tf-email">Email</label><input class="field" type="email" id="tf-email" data-model="teamForm.email" value="${esc(f.email)}" placeholder="rahul@gmail.com"></div>
        <div style="display:grid;gap:6px"><label class="label" for="tf-role">Role</label><select class="field" id="tf-role" data-model="teamForm.role" style="width:100%"><option value="editor" ${f.role==='editor'?'selected':''}>Video editor</option><option value="client" ${f.role==='client'?'selected':''}>Client</option></select></div>
      </div>
      <div class="ctrls"><button class="btn primary" data-act="team-invite" ${pb('team-invite')}>${S.ui.pending.has('team-invite') ? 'Adding…' : 'Add and create login link'}</button></div>
      ${link ? `<div class="note"><b>Send this link to ${esc(link.name || 'them')}</b><span>It lets them set their own password. It works once and expires in 14 days.</span>
        <div class="linkrow"><input class="field mono" id="tl-url" value="${esc(link.url)}" readonly><button class="btn sm" data-act="copy-link">Copy</button></div>
        <div class="ctrls"><a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Send on WhatsApp ↗</a><button class="btn sm ghost" data-act="link-close">Done</button></div></div>` : ''}
    </div>
    <div class="panel"><div class="sec-h"><h2>People in this workspace</h2><span class="mono muted">${ps.length}</span></div><div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th class="num">Videos</th><th></th></tr></thead><tbody>
      ${ps.map(p => `<tr><td>${esc(p.name || '—')}</td><td class="muted">${esc(p.email || '')}</td>
        <td><select class="field" id="rl-${esc(p.id)}" data-chg="role" data-id="${esc(p.id)}"><option value="editor" ${p.role==='editor'?'selected':''}>Editor</option><option value="client" ${p.role==='client'?'selected':''}>Client</option></select></td>
        <td>${p.invited ? '<span class="pill s-ready">Invite pending</span>' : '<span class="pill s-ok">Active</span>'}</td>
        <td class="num">${p.role==='editor' ? allCombos(null).filter(x => editorOf(x) === p.id).length : '–'}</td>
        <td style="text-align:right"><div class="ctrls" style="justify-content:flex-end"><button class="btn sm" data-act="team-link" data-id="${esc(p.id)}" data-name="${esc(p.name||'')}" ${pb('team-link')}>New login link</button>
        <button class="btn sm danger ${S.ui.armed==='role:'+p.id?'armed':''}" data-act="team-remove" data-id="${esc(p.id)}">${S.ui.armed==='role:'+p.id?'Confirm remove':'Remove'}</button></div></td></tr>`).join('') || `<tr><td colspan="6" class="muted">No one yet. Add your editors and the client above.</td></tr>`}
    </tbody></table></div></div>
    <p class="muted" style="font-size:.86rem">"New login link" also works as a password reset. The old password stops working once they use it.</p>
  </div>`;
}

function settingsView(){
  const m = S.meta;
  return `<div class="page-h"><div><h1>Settings</h1><p>The client code and campaign code build every ad name, like <span class="mono">${esc((m.clientCode||'CLIENT').toUpperCase())}_OCT_PAIN_H3_B1_C1</span>. Use the same name in Meta Ads Manager to trace winning hooks.</p></div></div>
  <div class="stack">
    <div class="panel" style="padding:16px;display:grid;gap:12px">
      <h2>Client workspace</h2>
      <div class="grid2">
        <div style="display:grid;gap:6px"><label class="label" for="s-client">Client name</label><input class="field" id="s-client" data-blur="ws" data-f="name" value="${esc(m.clientName||'')}"></div>
        <div style="display:grid;gap:6px"><label class="label" for="s-code">Client code (2–6 letters)</label><input class="field mono" id="s-code" data-blur="ws" data-f="clientCode" value="${esc(m.clientCode||'')}" maxlength="6"></div>
      </div></div>
    <div class="panel"><div class="sec-h"><h2>Campaigns</h2><button class="btn sm" data-act="new-campaign">+ Campaign</button></div><div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Code</th><th>Drive upload folder</th><th class="num">Videos</th><th></th></tr></thead><tbody>
      ${campaigns().map(c => `<tr>
        <td><input class="field" id="cn-name-${esc(c.id)}" data-blur="camp" data-f="name" data-id="${esc(c.id)}" value="${esc(c.name)}" aria-label="Campaign name"></td>
        <td><input class="field mono" style="width:90px" id="cn-code-${esc(c.id)}" data-blur="camp" data-f="code" data-id="${esc(c.id)}" value="${esc(c.code||'')}" maxlength="8" aria-label="Campaign code"></td>
        <td><input class="field" type="url" style="min-width:220px" id="cn-drive-${esc(c.id)}" data-blur="camp" data-f="driveFolder" data-id="${esc(c.id)}" value="${esc(c.driveFolder||'')}" placeholder="https://drive.google.com/drive/folders/…" aria-label="Drive folder"></td>
        <td class="num">${allCombos(c.id).length}</td>
        <td style="text-align:right"><button class="btn sm danger ${S.ui.armed==='camp:'+c.id?'armed':''}" data-act="del-campaign" data-id="${esc(c.id)}">${S.ui.armed==='camp:'+c.id?'Delete everything':'Delete'}</button></td></tr>`).join('') || `<tr><td colspan="5" class="muted">No campaigns yet.</td></tr>`}
    </tbody></table></div></div>
    <div class="note"><b>Drive folder setup</b><span>Create one Google Drive folder per campaign. Share it with your editors as <b>Editor</b> so they can upload, and with the client as <b>Viewer</b> (or set it to "Anyone with the link can view") so every video opens for them. Paste the folder link above.</span></div>
    <div class="note"><b>Email alerts</b><span>Every hour you get one email listing videos marked ready, approved, sent back for changes, and new comments across all clients.</span></div>
    ${window.AI ? window.AI.settingsNote() : ''}
  </div>`;
}

function campaignModal(){
  const n = S.ui.newCampaign;
  return `<div class="scrim" data-act="close-scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="nc-t" style="width:min(520px,100%)">
    <div class="modal-h"><h2 id="nc-t">New campaign for ${esc(S.meta.clientName)}</h2><button class="btn ghost sm" data-act="close-campaign" aria-label="Close">✕</button></div>
    <div class="modal-b">
      <div style="display:grid;gap:6px"><label class="label" for="nc-name">Campaign name</label><input class="field" id="nc-name" data-model="newCampaign.name" value="${esc(n.name)}" placeholder="e.g. October batch"></div>
      <div style="display:grid;gap:6px"><label class="label" for="nc-code">Short code for ad names</label><input class="field mono" id="nc-code" data-model="newCampaign.code" value="${esc(n.code)}" maxlength="8" placeholder="OCT"></div>
      <div style="display:grid;gap:6px"><label class="label" for="nc-drive">Drive upload folder (optional)</label><input class="field" type="url" id="nc-drive" data-model="newCampaign.driveFolder" value="${esc(n.driveFolder)}" placeholder="https://drive.google.com/drive/folders/…"></div>
    </div>
    <div class="modal-f"><button class="btn" data-act="close-campaign">Cancel</button><button class="btn primary" data-act="save-campaign" ${pb('save-campaign')}>Create campaign</button></div>
  </div></div>`;
}
function wsModal(){
  return `<div class="scrim" data-act="close-scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="nw-t" style="width:min(520px,100%)">
    <div class="modal-h"><h2 id="nw-t">New client workspace</h2><button class="btn ghost sm" data-act="close-ws" aria-label="Close">✕</button></div>
    <div class="modal-b">${wsForm()}<p class="muted" style="font-size:.86rem">This client's team will only see this workspace.</p></div>
    <div class="modal-f"><button class="btn" data-act="close-ws">Cancel</button><button class="btn primary" data-act="save-ws" ${pb('save-ws')}>Create workspace</button></div>
  </div></div>`;
}
function importModal(){
  const im = S.ui.import;
  const existing = anglesOf(S.ui.campaignId);
  let body = '', foot = '';
  if(im.stage === 'input'){
    body = `<p class="muted">Paste your script as it is (Hook 1, Hook 2, Body 1, a "Hooks sorted by body" table…), Claude's JSON answer, or this format:</p>
      <pre class="fmt">ANGLE: PAIN | Content takes too much time
HOOK: Roz 4 ghante content banane mein laga rahe ho?
HOOK: Har Monday content calendar khaali hota hai?
BODY: …
CTA: Neeche button dabao…

ANGLE: CURIOSITY | 30 days of content in one sitting
HOOK: …</pre>
      <div class="ctrls"><button class="btn sm" data-act="copy-prompt">Copy sorting prompt for Claude</button><span class="muted" style="font-size:.84rem">Paste it in Claude with your script, then paste Claude's answer here.</span></div>
      <textarea class="field" id="im-text" data-model="import.text" rows="12" style="min-height:220px" placeholder="Paste here">${esc(im.text)}</textarea>
      ${im.error ? `<p class="err">${esc(im.error)}</p>` : ''}`;
    foot = `<button class="btn" data-act="import-close">Cancel</button>${window.AI ? window.AI.importButton() : ''}<button class="btn primary" data-act="parse">Review angles</button>`;
  } else {
    const A = im.result.angles;
    const nh = A.filter(a => a.on).reduce((s,a) => s + a.hooks.filter(h => h.on).length, 0);
    body = `${window.IMPORTER ? window.IMPORTER.reportHtml(im.result.report, esc) : ''}
    <p class="muted">Untick anything you don't want. Rename angles or add them to an existing folder.</p>
    ${A.map((a,i) => `<div class="prop">
      <div class="prop-h"><input type="checkbox" id="pa-${i}" data-model="import.result.angles.${i}.on" ${a.on?'checked':''} aria-label="Include angle">
        <select class="field" id="pt-${i}" data-model="import.result.angles.${i}.type" aria-label="Angle type">${TYPES.map(t => `<option value="${t.t}" ${a.type===t.t?'selected':''}>${t.label}</option>`).join('')}</select>
        <input class="field" style="flex:1 1 200px;width:auto" id="pn-${i}" data-model="import.result.angles.${i}.name" value="${esc(a.name)}" aria-label="Angle name">
        <select class="field" id="px-${i}" data-model="import.result.angles.${i}.existingId" aria-label="Save into"><option value="">New folder</option>${existing.map(e => `<option value="${esc(e.id)}" ${a.existingId===e.id?'selected':''}>Add to: ${esc(e.name)}</option>`).join('')}</select>
      </div>
      <div class="prop-b">${a.why ? `<p class="muted" style="font-size:.86rem">${esc(a.why)}</p>` : ''}
        ${['hooks','bodies','ctas'].map(k => a[k].length ? `<div style="display:grid;gap:6px"><span class="label">${KIND[k].many}</span>${a[k].map((it,j) => {
          const pick = `<label class="pick ${it.flag?'flagged':''}"><input type="checkbox" id="pi-${i}-${k}-${j}" data-model="import.result.angles.${i}.${k}.${j}.on" ${it.on?'checked':''}><span style="white-space:pre-wrap">${it.label ? `<span class="imp-label">${esc(it.label)}</span>` : ''}${esc(it.t)}${it.flag ? `<em class="imp-flag">${esc(it.flag)}</em>` : ''}</span></label>`;
          if(k !== 'hooks' || A.length < 2) return pick;
          const to = it.to === undefined || it.to === '' ? i : Number(it.to);
          return `<div class="pick-row">${pick}<select class="field imp-move" id="pm-${i}-${j}" data-model="import.result.angles.${i}.hooks.${j}.to" aria-label="Move this hook to another folder">${A.map((b,bi) => `<option value="${bi}" ${bi===to?'selected':''}>${bi===i ? 'Keep in this folder' : 'Move to: ' + esc(b.name)}</option>`).join('')}</select></div>`;
        }).join('')}</div>` : (k !== 'hooks' ? `<p class="muted" style="font-size:.84rem">No ${KIND[k].one.toLowerCase()} for this angle. You can add one later.</p>` : '')).join('')}
      </div></div>`).join('')}`;
    const vids = window.IMPORTER && window.IMPORTER.videoCount ? window.IMPORTER.videoCount(im.result) : null;
    foot = `<span class="muted" style="margin-right:auto;align-self:center">${A.filter(a=>a.on).length} angles · ${nh} hooks${vids === null ? '' : ` · ${vids} video${vids===1?'':'s'}`}</span>
      <button class="btn" data-act="import-back">Back</button>
      <button class="btn primary" data-act="import-save" ${im.stage==='saving'?'disabled':''}>${im.stage==='saving' ? 'Saving…' : 'Create angle folders'}</button>`;
  }
  return `<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="im-t">
    <div class="modal-h"><h2 id="im-t">Import script</h2><button class="btn ghost sm" data-act="import-close" aria-label="Close">✕</button></div>
    <div class="modal-b">${body}</div><div class="modal-f">${foot}</div></div></div>`;
}
function csv(){
  const rows = [['Ad name','Campaign','Angle','Angle type','Hook','Body','CTA','Editor','Status','Drive link','Client feedback']];
  for(const x of allCombos(S.ui.campaignId)) rows.push([adName(x), S.col.campaigns[x.angle.campaignId]?.name, x.angle.name, typeOf(x.angle.type).label, x.h.text, x.b.text, x.c.text, editorOf(x) ? nameOf(editorOf(x)) : '', STATUS[statusOf(x)].l, x.v?.driveLink || '', x.v?.clientNote || '']);
  return rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
}
function exportCsv(){
  const name = ((S.meta.clientCode || 'client') + '-' + (curCampaign()?.code || 'campaign') + '-videos.csv').toLowerCase();
  const blob = new Blob(['\ufeff' + csv()], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function copyText(t, msg){
  try{ navigator.clipboard.writeText(t).then(() => toast(msg || 'Copied.'), () => toast('Copy was blocked. Select the text and copy it yourself.', true)); }
  catch{ toast('Copy was blocked. Select the text and copy it yourself.', true); }
}

document.addEventListener('toggle', e => {
  const d = e.target; if(!(d instanceof HTMLDetailsElement) || !d.dataset.key) return;
  if(d.open) S.ui.open.add(d.dataset.key); else S.ui.open.delete(d.dataset.key);
}, true);
document.addEventListener('input', e => {
  const el = e.target; if(!el.dataset || !el.dataset.model) return;
  if(el.type === 'radio' && !el.checked) return;
  setPath(S.ui, el.dataset.model, el.type === 'checkbox' ? el.checked : el.value);
  if(el.type === 'checkbox' && el.dataset.model.startsWith('import.')) render();
});
document.addEventListener('change', e => {
  const el = e.target;
  if(el.dataset && el.dataset.model && (el.type === 'radio' || el.type === 'checkbox' || el.tagName === 'SELECT')){
    if(el.type === 'radio' && !el.checked) return;
    setPath(S.ui, el.dataset.model, el.type === 'checkbox' ? el.checked : el.value);
    if(el.tagName === 'SELECT' && /^(import\.result\.|aiVar\.)/.test(el.dataset.model)){ el.blur(); render(); }
    return;
  }
  const a = el.dataset && el.dataset.chg; if(a) onChange(a, el);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if(!f) return;
  e.preventDefault();
  if(f.dataset.form === 'login') doLogin();
  if(f.dataset.form === 'invite') doInvite();
});
async function doLogin(){
  const l = S.ui.login;
  S.ui.busy = true; render();
  try{
    await api('login', {email:l.email, password:l.password});
    S.ui.login = {email:'', password:''};
    S.loaded = false; await syncAll();
  }catch(e){ toast(e.message, true); }
  S.ui.busy = false; render();
}
async function doInvite(){
  const f = S.ui.inv;
  if((f.password||'').length < 8){ toast('Use a password of at least 8 characters.', true); return; }
  if(f.password !== f.confirm){ toast("The two passwords don't match.", true); return; }
  S.ui.busy = true; render();
  try{
    await api('accept-invite', {token:S.invite.token, name:f.name || S.invite.info.name, password:f.password});
    history.replaceState(null, '', '/');
    S.invite = null; S.ui.inv = {name:'', password:'', confirm:''};
    await syncAll();
    toast('Welcome! Your login is ready.');
  }catch(e){ toast(e.message, true); }
  S.ui.busy = false; render();
}
const video = (key, patch, ok) => M(() => localVideo(key, patch), () => api('video-set', {key, patch}), ok);
async function onChange(a, el){
  const d = el.dataset;
  if(a === 'ws'){
    S.wsId = el.value; ls.set('ws', el.value); S.ui.campaignId = null; S.ui.angleId = null; S.ui.teamLink = null; el.blur();
    const cached = ls.get('cache:' + S.wsId, null);
    if(cached) applyData(cached, true); else { S.loaded = false; S.col = EMPTY_COL(); }
    render(); await load().catch(handleErr); return;
  }
  if(a === 'campaign'){ S.ui.campaignId = el.value; S.ui.angleId = null; S.ui.filter = {status:'all',editor:'all',angle:'all'}; el.blur(); render(); return; }
  if(a === 'filter'){ S.ui.filter[d.f] = el.value; el.blur(); render(); return; }
  if(a === 'tick'){
    const x = findCombo(d.key); if(!x) return;
    if(el.checked && !x.v?.driveLink) toast('Marked done. Add the Drive link so the client can watch it.');
    video(d.key, {status: el.checked ? 'ready' : 'editing'});
    return;
  }
  if(a === 'video-editor'){ el.blur(); await video(d.key, {editorId:el.value || null}, 'Editor assigned.'); return; }
  if(a === 'video-status'){ el.blur(); await video(d.key, {status:el.value}, 'Status updated.'); return; }
  if(a === 'angle-editor'){ el.blur(); const v = el.value || null; await M(() => { S.col.angles[d.id].editorId = v; }, () => api('angle-update', {id:d.id, editorId:v}), 'Default editor set for this angle.'); return; }
  if(a === 'angle-type'){ el.blur(); const v = el.value; await M(() => { S.col.angles[d.id].type = v; }, () => api('angle-update', {id:d.id, type:v})); return; }
  if(a === 'role'){ el.blur(); const v = el.value; await M(() => { if(S.people[d.id]) S.people[d.id].role = v; }, () => api('team-role', {ws:S.wsId, userId:d.id, role:v}), 'Role updated.'); return; }
}
document.addEventListener('focusout', e => {
  const el = e.target; const a = el.dataset && el.dataset.blur; if(a) onBlur(a, el);
});
async function onBlur(a, el){
  if(a.startsWith('kit-')) return window.KIT && window.KIT.blur(a, el);
  const d = el.dataset, v = el.value.trim();
  if(a === 'item'){ const it = S.col[d.kind][d.id]; if(!it || it.text === v) return; if(!v){ el.value = it.text; return; } await M(() => { it.text = v; }, () => api('item-update', {id:d.id, text:v})); return; }
  if(a === 'angle-name'){ const ang = S.col.angles[d.id]; if(!ang || ang.name === v) return; if(!v){ el.value = ang.name; return; } await M(() => { ang.name = v; }, () => api('angle-update', {id:d.id, name:v})); return; }
  if(a === 'drive'){
    const x = findCombo(d.key); if(!x || (x.v?.driveLink || '') === v) return;
    if(v && !isUrl(v)){ toast('Paste a full link that starts with https://', true); return; }
    await video(d.key, {driveLink:v}, v ? 'Video link saved.' : 'Video link removed.'); return;
  }
  if(a === 'enote'){ const x = findCombo(d.key); if(!x || (x.v?.editorNote || '') === v) return; await video(d.key, {editorNote:v}, 'Note saved.'); return; }
  if(a === 'ws'){
    const cur = d.f === 'name' ? S.meta.clientName : S.meta.clientCode;
    if((cur || '') === v) return;
    const ok = await M(() => { if(d.f === 'name') S.meta.clientName = v; else S.meta.clientCode = v.toUpperCase(); }, () => api('ws-update', {ws:S.wsId, [d.f]:v}), 'Saved.');
    if(ok) await refreshMe().catch(() => {});
    render(); return;
  }
  if(a === 'camp'){
    const c = S.col.campaigns[d.id]; if(!c || (c[d.f] || '') === v) return;
    if(d.f === 'driveFolder' && v && !isUrl(v)){ toast('Paste a full folder link that starts with https://', true); return; }
    await M(() => { c[d.f] = v; }, () => api('campaign-update', {id:d.id, [d.f]:v}), 'Saved.'); return;
  }
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if(!t || t.disabled) return;
  if(t.dataset.act === 'close-scrim' && e.target !== t) return;
  onClick(t.dataset.act, t, e);
});
// Actions that wait for the server show a busy button and ignore repeat clicks.
const BUSY_ACTS = new Set(['team-invite','save-campaign','save-ws','add-angle','add-items','team-link']);
const handleClick = onClick_;
async function onClick(a, t, e){
  if(a.startsWith('kit-')) return window.KIT && window.KIT.click(a, t, e);
  if(a.startsWith('ai-')) return window.AI && window.AI.click(a, t, e);
  if(!BUSY_ACTS.has(a)) return handleClick(a, t, e);
  const k = a + (a === 'add-items' ? t.dataset.kind : '');
  if(S.ui.pending.has(k)) return;
  S.ui.pending.add(k); render();
  try{ await handleClick(a, t, e); } finally{ S.ui.pending.delete(k); render(); }
}
function arm(key){ S.ui.armed = key; render(); setTimeout(() => { if(S.ui.armed === key){ S.ui.armed = null; render(); } }, 4000); }
async function onClick_(a, t){
  const d = t.dataset;
  switch(a){
    case 'tab': S.ui.tab = d.tab; render(); window.scrollTo(0,0); return;
    case 'logout': try{ await api('logout'); }catch{} clearCache(); S.me = null; S.workspaces = []; S.wsId = null; S.loaded = false; S.col = EMPTY_COL(); render(); return;
    case 'reload': location.reload(); return;
    case 'angle': S.ui.angleId = d.id; S.ui.add = {hooks:'',bodies:'',ctas:''}; render(); return;
    case 'add-angle': {
      const na = S.ui.newAngle; let id = null;
      const ok = await W(async () => { id = (await api('angle-create', {campaignId:S.ui.campaignId, type:na.type, name:na.name.trim()})).id; }, 'Angle folder added.');
      if(ok){ S.ui.angleId = id; S.ui.newAngle = {type:na.type, name:''}; }
      render(); return;
    }
    case 'add-items': {
      const k = d.kind, text = S.ui.add[k] || '';
      const list = k === 'hooks' ? text.split(/\n+/) : [text];
      if(!list.some(s => s.trim())){ toast(`Type a ${KIND[k].one.toLowerCase()} first.`, true); return; }
      let n = 0;
      const ok = await W(async () => { n = (await api('items-add', {angleId:S.ui.angleId, kind:k, texts:list})).added; });
      if(ok){ S.ui.add[k] = ''; toast(n ? `Added ${n} ${n===1 ? KIND[k].one.toLowerCase() : KIND[k].many.toLowerCase()}.` : 'Already in this folder.'); }
      render(); return;
    }
    case 'del-item': if(S.ui.armed !== 'item:' + d.id) return arm('item:' + d.id); S.ui.armed = null; await W(() => api('item-delete', {id:d.id}), 'Deleted.'); render(); return;
    case 'del-angle': if(S.ui.armed !== 'angle:' + d.id) return arm('angle:' + d.id); S.ui.armed = null; await W(() => api('angle-delete', {id:d.id}), 'Angle deleted.'); S.ui.angleId = null; render(); return;
    case 'del-campaign': if(S.ui.armed !== 'camp:' + d.id) return arm('camp:' + d.id); S.ui.armed = null; await W(() => api('campaign-delete', {id:d.id}), 'Campaign deleted.'); render(); return;
    case 'del-comment': if(S.ui.armed !== 'cmt:' + d.id) return arm('cmt:' + d.id); S.ui.armed = null; await M(() => { delete S.col.comments[d.id]; }, () => api('comment-delete', {id:d.id})); return;
    case 'status': {
      const x = findCombo(d.key); if(!x) return;
      const link = document.getElementById('dl-' + d.key)?.value.trim() || '';
      if(d.s === 'ready' && !x.v?.driveLink && !link){ toast('Paste the video link first so the client can watch it.', true); document.getElementById('dl-' + d.key)?.focus(); return; }
      if(link && !isUrl(link)){ toast('Paste a full link that starts with https://', true); return; }
      const patch = {status:d.s}; if(link && link !== (x.v?.driveLink || '')) patch.driveLink = link;
      await video(d.key, patch, d.s === 'ready' ? 'Sent for review.' : 'Marked as editing.'); return;
    }
    case 'approve': {
      const n = (S.ui.note[d.key] || '').trim();
      delete S.ui.note[d.key];
      await video(d.key, {status:'approved', clientNote:n}, 'Approved.'); return;
    }
    case 'changes': {
      const n = (S.ui.note[d.key] || '').trim();
      if(!n){ toast('Write what should change, so the editor knows what to fix.', true); document.getElementById('cn-' + d.key)?.focus(); return; }
      delete S.ui.note[d.key];
      await M(() => { localVideo(d.key, {status:'changes', clientNote:n}); localComment(d.key, 'Requested changes: ' + n, ''); },
        async () => { await api('video-set', {key:d.key, patch:{status:'changes', clientNote:n}}); await api('comment-add', {key:d.key, text:'Requested changes: ' + n, tc:''}); }, 'Feedback sent to the editor.');
      return;
    }
    case 'post-comment': {
      const dr = S.ui.cdraft[d.key] || {}, text = String(dr.text||'').trim();
      if(!text){ toast('Write a comment first.', true); return; }
      const tc = String(dr.tc||'').trim();
      S.ui.cdraft[d.key] = {text:'', tc:''};
      await M(() => localComment(d.key, text, tc), () => api('comment-add', {key:d.key, text, tc})); return;
    }
    case 'copy-name': { const x = findCombo(d.key); if(x) copyText(adName(x), 'Ad name copied.'); return; }
    case 'copy-script': { const x = findCombo(d.key); if(x) copyText(`${x.h.text}\n\n${x.b.text}\n\n${x.c.text}`, 'Script copied.'); return; }
    case 'copy-prompt': if(window.IMPORTER) copyText(window.IMPORTER.PROMPT, 'Prompt copied. Paste it in Claude, add your script below it, and send.'); return;
    case 'copy-link': copyText(S.ui.teamLink?.url || '', 'Link copied.'); return;
    case 'link-close': S.ui.teamLink = null; render(); return;
    case 'export': exportCsv(); return;
    case 'new-campaign': S.ui.newCampaign = {name:'', code:'', driveFolder:''}; render(); setTimeout(() => document.getElementById('nc-name')?.focus(), 0); return;
    case 'close-campaign': S.ui.newCampaign = null; render(); return;
    case 'close-scrim': S.ui.newCampaign = null; S.ui.newWsOpen = false; render(); return;
    case 'new-ws': S.ui.newWs = {name:'', clientCode:''}; S.ui.newWsOpen = true; render(); setTimeout(() => document.getElementById('nw-name')?.focus(), 0); return;
    case 'close-ws': S.ui.newWsOpen = false; render(); return;
    case 'save-ws': {
      const n = S.ui.newWs || {};
      if(!String(n.name||'').trim()){ toast('Give the client a name.', true); return; }
      try{
        const r = await api('ws-create', {name:n.name.trim(), clientCode:n.clientCode});
        S.wsId = r.id; ls.set('ws', r.id); S.ui.newWs = null; S.ui.newWsOpen = false; S.ui.campaignId = null;
        S.loaded = false; await syncAll(); S.ui.tab = 'board'; toast('Workspace created. Add a campaign next.');
      }catch(e){ handleErr(e); }
      render(); return;
    }
    case 'save-campaign': {
      const n = S.ui.newCampaign;
      if(!n.name.trim()){ toast('Give the campaign a name.', true); return; }
      if(n.driveFolder.trim() && !isUrl(n.driveFolder)){ toast('The Drive folder link must start with https://', true); return; }
      let id = null;
      const ok = await W(async () => { id = (await api('campaign-create', {ws:S.wsId, name:n.name.trim(), code:n.code, driveFolder:n.driveFolder.trim()})).id; }, 'Campaign created.');
      if(ok){ S.ui.newCampaign = null; S.ui.campaignId = id; S.ui.tab = 'board'; }
      render(); return;
    }
    case 'import-open': S.ui.import = {stage:'input', text:'', result:null, error:''}; render(); setTimeout(() => document.getElementById('im-text')?.focus(), 0); return;
    case 'import-close': S.ui.import = null; render(); return;
    case 'import-back': S.ui.import.stage = 'input'; render(); return;
    case 'parse': {
      const im = S.ui.import;
      if(!im.text.trim()){ im.error = 'Paste a script first.'; render(); return; }
      if(!window.IMPORTER){ im.error = 'The script reader is still loading. Try again in a second.'; render(); return; }
      try{
        const cid = S.ui.campaignId;
        const existing = vals('hooks').filter(h => S.col.angles[h.angleId]?.campaignId === cid).map(h => ({text:h.text, angle:S.col.angles[h.angleId].name}));
        const r = window.IMPORTER.parse(im.text, {existing, angles:anglesOf(cid).map(a => ({id:a.id, name:a.name}))});
        if(!r.angles.length){ im.error = 'No hooks found. Label them like "Hook 1:", "Body 1:", "CTA:", or paste the JSON from Claude.'; render(); return; }
        im.result = r; im.stage = 'review'; im.error = '';
      }catch(e){ im.error = e.message || "That couldn't be read. Clear this box (Ctrl+A, Delete) and paste again."; }
      render(); return;
    }
    case 'import-save': {
      const im = S.ui.import; im.stage = 'saving'; render();
      const payload = window.IMPORTER.payload(im.result);
      let r = null;
      const ok = await W(async () => { r = await api('import', {campaignId:S.ui.campaignId, angles:payload}); });
      if(ok){ toast(`Added ${r.hooks} hooks across ${r.angles} new angle folder${r.angles===1?'':'s'}.`); S.ui.import = null; S.ui.angleId = null; }
      else im.stage = 'review';
      render(); return;
    }
    case 'team-invite': {
      const f = S.ui.teamForm;
      if(!f.email.trim()){ toast('Enter their email.', true); return; }
      let r = null;
      const ok = await W(async () => { r = await api('team-invite', {ws:S.wsId, name:f.name.trim(), email:f.email.trim(), role:f.role}); });
      if(ok){
        if(r.link){ S.ui.teamLink = {url:r.link, name:f.name.trim()}; toast('Added. Send them the login link.'); }
        else toast('Added. They already have a login and will see this workspace next time they open the app.');
        S.ui.teamForm = {name:'', email:'', role:f.role};
      }
      render(); return;
    }
    case 'team-link': {
      try{ const r = await api('team-link', {userId:d.id}); S.ui.teamLink = {url:r.link, name:d.name}; toast('New login link ready.'); }catch(e){ handleErr(e); }
      render(); window.scrollTo(0,0); return;
    }
    case 'team-remove': if(S.ui.armed !== 'role:' + d.id) return arm('role:' + d.id); S.ui.armed = null; await W(() => api('team-remove', {ws:S.wsId, userId:d.id}), 'Removed from this workspace.'); render(); return;
  }
}

setInterval(() => {
  if(document.visibilityState !== 'visible' || !S.me || !S.wsId || S.ui.import || S.ui.busy) return;
  load().catch(e => { if(e.status === 401) handleErr(e); });
}, 20000);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && S.me && S.wsId) load().catch(() => {}); });

async function boot(){
  const inv = new URLSearchParams(location.search).get('invite');
  if(inv){
    S.invite = {token:inv, info:null, err:''}; S.ready = true; render();
    try{ S.invite.info = await api('invite-info', {token:inv}); S.ui.inv.name = S.invite.info.name || ''; }
    catch(e){ S.invite.err = e.status === 503 ? 'The app is still being set up. Try again in a few minutes.' : e.message; }
    render(); return;
  }
  const cached = ls.get('boot', null), ws = ls.get('ws', null), data = ws && ls.get('cache:' + ws, null);
  if(cached && cached.user && data){
    S.me = cached.user; S.workspaces = cached.workspaces || []; S.wsId = ws; applyData(data, true); S.ready = true;
  }
  render();
  try{ await syncAll(); }
  catch(e){
    if(e.status === 401){ S.me = null; clearCache(); }
    else if(e.status === 503) S.bootErr = 'The app is still being set up. The database will be connected in a few minutes.';
    else if(!S.me) S.bootErr = 'The app could not start: ' + e.message;
    else toast("Couldn't refresh. Showing your last saved view.", true);
  }
  S.ready = true; render();
}
window.HS = {S, esc, render, toast, handleErr, copyText, api, load, vals, anglesOf, itemsOf};
boot();
})();
