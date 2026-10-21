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
    if(el.tagName === 'SELECT' && /^(import\.result\.|aiVar\.|bulk\.)/.test(el.dataset.model)){ el.blur(); render(); }
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
  if(rolesChange(a, el)) return;
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
  { const h = rolesClick(a, t); if(h){ await h; return; } }
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
