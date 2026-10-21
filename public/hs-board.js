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
  if(r === 'editor') return [['queue','My queue'],['hooks','Hooks'],['kit','Client kit'],['dashboard','Progress']];
  return [['dashboard','Overview'],['hooks','Hooks'],['review','Review'],['all','All videos']];
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
  if(t === 'hooks') return hooksView(r);
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
      <div class="items">${list.map(i => `<div class="item">${itemHead(kind, i, K)}
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
    <span class="vchecks">${bulkBox(x, p)}<input type="checkbox" class="tick" id="tk-${esc(x.key)}" data-chg="tick" data-key="${esc(x.key)}" ${isDone(s)?'checked':''} ${p.tick?'':'disabled'} aria-label="Mark ${esc(adName(x))} done"></span>
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

