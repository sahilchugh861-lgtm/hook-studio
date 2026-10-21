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
    ${bulkBar(list)}
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

