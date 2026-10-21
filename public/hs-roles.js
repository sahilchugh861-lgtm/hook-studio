/* Roles layer: Hooks tab (client + editor), "shot" ticks, bulk assign, and the two-team Team page.
   Loaded as a plain script after hs-admin.js, so it shares the global helpers (S, esc, M, api, ...). */

const bulk = () => S.ui.bulk || (S.ui.bulk = { sel: new Set(), editor: '' });
const shotOf = it => !!(it && it.shotAt);

/* ---------- shot tick next to every hook (admin board) ---------- */
function itemHead(kind, i, K) {
  const code = `<span class="code">${K.p}${i.n}</span>`;
  return `<span class="itemhead"><input type="checkbox" class="tick" data-chg="hook-shot" data-kind="${kind}" data-id="${esc(i.id)}" ${i.shotAt ? 'checked' : ''} aria-label="${K.one} ${K.p}${i.n} has been shot" title="Tick when this ${K.one.toLowerCase()} has been shot">${code}</span>`;
}
const KINDS3 = ['hooks', 'bodies', 'ctas'];
const allOf = id => KINDS3.flatMap(k => itemsOf(k, id).map(i => ({ ...i, kind: k })));

/* ---------- Hooks tab for client and editor ---------- */
function hooksView(r) {
  const cid = S.ui.campaignId === '__all' ? null : S.ui.campaignId;
  const angles = cid ? anglesOf(cid) : campaigns().flatMap(c => anglesOf(c.id));
  const canTick = r === 'client' || r === 'admin';
  let total = 0, shot = 0;
  const line = (x, isShot) => { const K = KIND[x.kind]; return `<div class="hookrow ${isShot ? 'shot' : ''}">
        <input type="checkbox" class="tick" id="hk-${esc(x.id)}" data-chg="hook-shot" data-kind="${x.kind}" data-id="${esc(x.id)}" ${isShot ? 'checked' : ''} ${canTick ? '' : 'disabled'} aria-label="${K.one} ${K.p}${x.n} has been shot">
        <span class="code">${K.p}${x.n}</span>
        <div class="htext"><span class="label">${K.one}</span><p>${esc(x.text)}</p></div></div>`; };
  const info = angles.map(a => {
    const all = allOf(a.id); total += all.length; const sh = all.filter(shotOf); shot += sh.length;
    return { a, all, sh, todo: all.filter(x => !shotOf(x)) };
  }).filter(o => o.all.length);
  const head = (o, n, label) => { const t = typeOf(o.a.type); return `<div class="bench-h"><span class="chip" style="--h:${t.h}">${esc(t.label)}</span>
        <h2 style="flex:1 1 220px">${esc(o.a.name)}</h2><span class="mono muted">${n} ${label}</span>`; };
  const todoBlocks = info.filter(o => o.todo.length).map(o => `<div class="panel">
      ${head(o, o.todo.length, 'to shoot')}
        ${canTick ? `<button class="btn sm" data-act="hooks-all" data-id="${esc(o.a.id)}" data-on="1">Tick all as shot</button>` : ''}</div>
      ${o.a.why ? `<p class="why">${esc(o.a.why)}</p>` : ''}
      <div class="rows">${o.todo.map(x => line(x, false)).join('')}</div></div>`).join('');
  const shotBlocks = info.filter(o => o.sh.length).map(o => `<div class="panel">
      ${head(o, o.sh.length, 'shot')}
        ${canTick ? `<button class="btn sm ghost" data-act="hooks-all" data-id="${esc(o.a.id)}" data-on="0">Untick all</button>` : ''}</div>
      <div class="rows">${o.sh.map(x => line(x, true)).join('')}</div></div>`).join('');
  const pct = total ? Math.round(shot / total * 100) : 0;
  const intro = canTick ? 'Tick a hook, body or CTA once it has been shot. It moves to the Shot section below. The admin and editors see it straight away.' : 'These are the hooks, bodies and CTAs of your angles. Once the client confirms something is shot, it moves to the Shot section.';
  const none = `<div class="empty"><h2>No hooks yet</h2><p>${r === 'editor' ? 'Hooks show up here once the admin gives you an angle or videos to edit.' : 'When the team adds hooks for your campaign, they appear here.'}</p></div>`;
  return `<div class="page-h"><div><h1>Hooks</h1><p>${intro}</p></div></div>
    ${total ? `<div class="panel" style="padding:14px 16px;display:grid;gap:8px"><div class="ctrls"><b>${shot} of ${total} shot</b><span class="muted mono">${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>` : ''}
    ${total ? `<div class="stack" style="margin-top:16px">
      <div class="sec-h"><h2>To shoot</h2><span class="mono muted">${total - shot}</span></div>
      ${todoBlocks || `<div class="empty"><p>Everything has been shot.</p></div>`}
      <div class="sec-h" style="margin-top:12px"><h2>Shot ✓</h2><span class="mono muted">${shot}</span></div>
      ${shotBlocks || `<div class="empty"><p>Nothing shot yet. Ticked items land here.</p></div>`}</div>` : `<div class="stack" style="margin-top:16px">${none}</div>`}`;
}

/* ---------- bulk assign on the Production tab ---------- */
function shownProd() {
  const f = S.ui.filter; let list = allCombos(S.ui.campaignId);
  if (f.status !== 'all') list = list.filter(x => statusOf(x) === f.status);
  if (f.editor !== 'all') list = list.filter(x => (editorOf(x) || '') === (f.editor === 'none' ? '' : f.editor));
  if (f.angle !== 'all') list = list.filter(x => x.angle.id === f.angle);
  return list;
}
function bulkBox(x, p) {
  if (!p.assign || S.ui.tab !== 'production') return '';
  return `<input type="checkbox" class="vsel" data-chg="bulk-sel" data-key="${esc(x.key)}" ${bulk().sel.has(x.key) ? 'checked' : ''} aria-label="Select ${esc(adName(x))}">`;
}
function bulkBar(list) {
  const b = bulk(), eds = editors();
  const mine = [...b.sel].filter(k => findCombo(k)).length;
  return `<div class="bulkbar"><div class="ctrls"><b>${mine} selected</b>
      <button class="btn sm" data-act="bulk-all">Select all ${list.length} shown</button>
      <button class="btn sm ghost" data-act="bulk-clear" ${mine ? '' : 'disabled'}>Clear</button></div>
    <div class="ctrls"><label class="ctrls" style="gap:6px"><span class="label">Assign to</span>
      <select class="field" id="bulk-ed" data-model="bulk.editor" aria-label="Editor for the selected videos"><option value="">Choose editor…</option><option value="__none" ${b.editor === '__none' ? 'selected' : ''}>Nobody (unassign)</option>
        ${eds.map(e => `<option value="${esc(e.id)}" ${b.editor === e.id ? 'selected' : ''}>${esc(nameOf(e.id))}</option>`).join('')}</select></label>
      <button class="btn sm primary" data-act="bulk-apply" ${mine && b.editor ? '' : 'disabled'}>Assign ${mine || ''}</button></div></div>`;
}

/* ---------- Team page: OccultPreneur team and the client's team ---------- */
function teamView() {
  const all = Object.values(S.people), link = S.ui.teamLink;
  const op = all.filter(p => p.role === 'admin' || p.role === 'editor');
  const cl = all.filter(p => p.role === 'client');
  const wa = link ? 'https://wa.me/?text=' + encodeURIComponent(`Hi ${link.name || ''}, here is your login link for the ${S.meta.clientName} ad videos board: ${link.url}`) : '';
  const form = (k, title, hint, btn, ph) => {
    const f = S.ui.teamForm[k];
    return `<div style="display:grid;gap:10px;padding:16px;border-bottom:1px solid var(--line)"><div><h2>${title}</h2><p class="muted" style="font-size:.88rem">${hint}</p></div>
      <div class="grid2">
        <div style="display:grid;gap:6px"><label class="label" for="tf-${k}-name">Name</label><input class="field" id="tf-${k}-name" data-model="teamForm.${k}.name" value="${esc(f.name)}" placeholder="${ph[0]}"></div>
        <div style="display:grid;gap:6px"><label class="label" for="tf-${k}-email">Email</label><input class="field" type="email" id="tf-${k}-email" data-model="teamForm.${k}.email" value="${esc(f.email)}" placeholder="${ph[1]}"></div>
      </div>
      <div class="ctrls"><button class="btn primary" data-act="team-invite" data-role="${k}" ${pb('team-invite')}>${S.ui.pending.has('team-invite') ? 'Adding…' : btn}</button></div></div>`;
  };
  const row = p => p.role === 'admin'
    ? `<tr><td>${esc(p.name || '—')}</td><td class="muted">${esc(p.email || '')}</td><td><span class="pill s-ok">Admin</span></td><td><span class="pill s-ok">Active</span></td><td class="num">–</td><td></td></tr>`
    : `<tr><td>${esc(p.name || '—')}</td><td class="muted">${esc(p.email || '')}</td>
      <td><select class="field" id="rl-${esc(p.id)}" data-chg="role" data-id="${esc(p.id)}"><option value="editor" ${p.role === 'editor' ? 'selected' : ''}>Editor (OccultPreneur)</option><option value="client" ${p.role === 'client' ? 'selected' : ''}>Client team</option></select></td>
      <td>${p.invited ? '<span class="pill s-ready">Invite pending</span>' : '<span class="pill s-ok">Active</span>'}</td>
      <td class="num">${p.role === 'editor' ? allCombos(null).filter(x => editorOf(x) === p.id).length : '–'}</td>
      <td style="text-align:right"><div class="ctrls" style="justify-content:flex-end"><button class="btn sm" data-act="team-link" data-id="${esc(p.id)}" data-name="${esc(p.name || '')}" ${pb('team-link')}>New login link</button>
      <button class="btn sm danger ${S.ui.armed === 'role:' + p.id ? 'armed' : ''}" data-act="team-remove" data-id="${esc(p.id)}">${S.ui.armed === 'role:' + p.id ? 'Confirm remove' : 'Remove'}</button></div></td></tr>`;
  const table = (people, empty) => `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th class="num">Videos</th><th></th></tr></thead><tbody>
    ${people.map(row).join('') || `<tr><td colspan="6" class="muted">${empty}</td></tr>`}</tbody></table></div>`;
  return `<div class="page-h"><div><h1>Team for ${esc(S.meta.clientName)}</h1><p>Two teams work on this client: your OccultPreneur team (editors) and the client's own team. The client's team only sees this client's workspace.</p></div></div>
  <div class="stack">
    ${link ? `<div class="note"><b>Send this link to ${esc(link.name || 'them')}</b><span>It lets them set their own password. It works once and expires in 14 days.</span>
      <div class="linkrow"><input class="field mono" id="tl-url" value="${esc(link.url)}" readonly><button class="btn sm" data-act="copy-link">Copy</button></div>
      <div class="ctrls"><a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Send on WhatsApp ↗</a><button class="btn sm ghost" data-act="link-close">Done</button></div></div>` : ''}
    <div class="panel">${form('editor', 'OccultPreneur team', 'Your video editors. They see the videos and hooks assigned to them and the Client kit.', 'Add editor and create login link', ['e.g. Rahul', 'rahul@gmail.com'])}
      <div class="sec-h"><h2>OccultPreneur team</h2><span class="mono muted">${op.length}</span></div>${table(op, 'No editors yet. Add your first editor above.')}</div>
    <div class="panel">${form('client', "Client's team", "The client and the people on their side. They watch videos, approve or ask for changes, and tick hooks once shot.", 'Add client member and create login link', ['e.g. Sanjay', 'client@gmail.com'])}
      <div class="sec-h"><h2>Client's team</h2><span class="mono muted">${cl.length}</span></div>${table(cl, "No one from the client's side yet. Add them above.")}</div>
    <p class="muted" style="font-size:.86rem">"New login link" also works as a password reset. The old password stops working once they use it.</p>
  </div>`;
}

/* ---------- events for the pieces above ---------- */
function rolesChange(a, el) {
  const d = el.dataset;
  if (a === 'hook-shot') {
    const it = (S.col[d.kind] || S.col.hooks)[d.id]; if (!it) return true;
    const on = el.checked;
    M(() => { it.shotAt = on ? now() : 0; }, () => api('hook-shot', { ids: [it.id], shot: on }), on ? 'Marked as shot.' : 'Unmarked.');
    return true;
  }
  if (a === 'bulk-sel') {
    const b = bulk(); if (el.checked) b.sel.add(d.key); else b.sel.delete(d.key);
    render(); return true;
  }
  return false;
}
function rolesClick(a, t) {
  const d = t.dataset;
  if (a === 'hooks-all') {
    const on = d.on === '1', hs = allOf(d.id).filter(h => shotOf(h) !== on).map(h => (S.col[h.kind] || {})[h.id]).filter(Boolean);
    if (!hs.length) return true;
    M(() => hs.forEach(h => { h.shotAt = on ? now() : 0; }), () => api('hook-shot', { ids: hs.map(h => h.id), shot: on }), on ? 'All marked as shot.' : 'Ticks removed.');
    return true;
  }
  if (a === 'bulk-all') { const b = bulk(); shownProd().forEach(x => b.sel.add(x.key)); render(); return true; }
  if (a === 'bulk-clear') { bulk().sel.clear(); render(); return true; }
  if (a === 'bulk-apply') {
    const b = bulk(), keys = [...b.sel].filter(k => findCombo(k)), e = b.editor === '__none' ? null : b.editor;
    if (!keys.length || !b.editor) return true;
    return (async () => {
      const ok = await M(() => keys.forEach(k => localVideo(k, { editorId: e })), () => api('video-bulk', { keys, editorId: e }), `${keys.length} video${keys.length === 1 ? '' : 's'} ${e ? 'assigned to ' + nameOf(e) : 'unassigned'}.`);
      if (ok) { b.sel.clear(); b.editor = ''; render(); }
    })();
  }
  if (a === 'team-invite') {
    const k = d.role === 'client' ? 'client' : 'editor', f = S.ui.teamForm[k];
    if (!String(f.email || '').trim()) { toast('Enter their email.', true); return true; }
    return (async () => {
      let r = null;
      const ok = await W(async () => { r = await api('team-invite', { ws: S.wsId, name: f.name.trim(), email: f.email.trim(), role: k }); });
      if (ok) {
        if (r.link) { S.ui.teamLink = { url: r.link, name: f.name.trim() }; toast('Added. Send them the login link.'); }
        else toast('Added. They already have a login and will see this workspace next time they open the app.');
        S.ui.teamForm[k] = { name: '', email: '' };
      }
      render();
    })();
  }
  return false;
}
