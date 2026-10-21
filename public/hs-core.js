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
       inv:{name:'',password:'',confirm:''}, teamForm:{editor:{name:'',email:''}, client:{name:'',email:''}}, bulk:{sel:new Set(), editor:''}, teamLink:null, busy:false, pending:new Set() }
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
