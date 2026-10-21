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
