// Client Kit: brief, brand and asset links for one client workspace.
// Admin edits it; editors read it. Hooks into app.js through window.HS.
(() => {
const KINDS = [
  ['broll', 'B-roll', '🎞️'], ['videos', 'Client videos', '🎥'], ['photos', 'Photos', '📷'],
  ['logo', 'Logo & brand files', '✦'], ['music', 'Music & SFX', '🎵'], ['fonts', 'Fonts', 'Aa'],
  ['refs', 'Reference ads', '⭐'], ['docs', 'Docs & scripts', '📄'], ['other', 'Other', '🔗']
];
const kindOf = k => KINDS.find(x => x[0] === k) || KINDS[KINDS.length - 1];
const FIELDS = [
  ['about', 'About the client', 'Who they are, what they sell, their story. e.g. B2B sales coach for MSME owners, 12 years experience.'],
  ['audience', 'Target audience', 'Who watches these ads: age, city tier, job, biggest pain.'],
  ['tone', 'Tone & language', 'e.g. Hinglish, high energy, talks like a mentor not a guru.'],
  ['style', 'Editing style', 'Captions style, pace, music mood, transitions, zooms, aspect ratios.'],
  ['dos', "Do's", 'What the editor should always do.'],
  ['donts', "Don'ts", 'What to avoid: words, visuals, competitor logos, music types.']
];
const K = { ws: null, data: null, at: 0, loading: false, err: '', busy: false, armed: null, editing: null };
const H = () => window.HS;
const LS = 'hms:kit:';

function cacheGet(ws) { try { return JSON.parse(localStorage.getItem(LS + ws) || 'null'); } catch { return null; } }
function cacheSet() { try { if (K.ws && K.data) localStorage.setItem(LS + K.ws, JSON.stringify(K.data)); } catch {} }

async function call(a, data = {}) {
  let r;
  try { r = await fetch('/api/kit', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ a, ...data }) }); }
  catch { const e = new Error('No connection. Check your internet and try again.'); e.status = 0; throw e; }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.message || 'Request failed. Try again.'); e.status = r.status; throw e; }
  return j;
}
function ensure(force) {
  const ws = H().S.wsId, uid = H().S.me && H().S.me.id; if (!ws) return;
  if (K.uid !== uid) { K.uid = uid; K.ws = null; }
  if (K.ws !== ws) { K.ws = ws; K.data = cacheGet(ws); K.at = 0; K.err = ''; K.editing = null; K.armed = null; }
  if (K.loading || (!force && K.data && Date.now() - K.at < 60000)) return;
  K.loading = true;
  call('get', { ws }).then(r => {
    if (H().S.wsId !== ws) return;
    K.data = r; K.at = Date.now(); K.err = ''; cacheSet(); H().render();
  }).catch(e => {
    if (H().S.wsId !== ws) return;
    if (e.status === 401) return H().handleErr(e);
    if (!K.data) { K.err = e.message; H().render(); }
  }).finally(() => { K.loading = false; });
}
async function save(a, payload, ok) {
  try { K.data = await call(a, payload); K.at = Date.now(); cacheSet(); if (ok) H().toast(ok); return true; }
  catch (e) { H().handleErr(e); ensure(true); return false; }
  finally { H().render(); }
}

/* ---------- helpers ---------- */
function driveId(u) {
  const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  return m ? m[1] : null;
}
const isFolder = u => /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//.test(u);
function thumbOf(u) {
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(u)) return u;
  const id = driveId(u);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w320` : '';
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function filled() {
  const p = K.data.profile || {};
  const checks = [p.about, p.audience, p.tone, p.style, (p.colors || []).length, p.masterFolder, K.data.assets.length];
  return [checks.filter(Boolean).length, checks.length];
}
function allText() {
  const S = H().S, p = K.data.profile || {}, out = [`Client kit: ${S.meta.clientName || ''}`];
  if (p.masterFolder) out.push('', 'Master folder: ' + p.masterFolder);
  for (const [k, l] of KINDS) {
    const xs = K.data.assets.filter(a => a.kind === k);
    if (!xs.length) continue;
    out.push('', l + ':');
    for (const a of xs) out.push(`- ${a.label}: ${a.url}${a.note ? '  (' + a.note + ')' : ''}`);
  }
  if ((p.colors || []).length) out.push('', 'Brand colours: ' + p.colors.map(c => (c.name ? c.name + ' ' : '') + c.hex).join(', '));
  if (p.fonts) out.push('Fonts: ' + p.fonts);
  return out.join('\n');
}

/* ---------- views ---------- */
function view(r) {
  ensure();
  const { S, esc } = H(), edit = r === 'admin';
  if (!K.data) {
    if (K.err) return `<div class="empty"><h2>Couldn't load the client kit</h2><p>${esc(K.err)}</p><button class="btn" data-act="kit-retry">Try again</button></div>`;
    return `<div class="empty"><div class="thinking"><span class="dot"></span>Loading client kit…</div></div>`;
  }
  const p = K.data.profile || {}, A = K.data.assets;
  const [f, t] = filled();
  const head = `<div class="page-h"><div><h1>Client kit · ${esc(S.meta.clientName || '')}</h1>
    <p>${edit ? 'Everything an editor needs for this client: the brief, brand and every file link. Your editors see this page; the client does not.' : 'Read this before you edit. Brand, tone and every file you need for this client are here.'}</p></div>
    <div class="ctrls">${edit ? `<span class="kmeter" title="Brief, audience, tone, editing style, colours, master folder, files"><i style="width:${Math.round(f / t * 100)}%"></i><b>${f}/${t} ready</b></span>` : ''}
    ${A.length || p.masterFolder ? `<button class="btn" data-act="kit-copy-all">Copy all links</button>` : ''}</div></div>`;
  const master = edit
    ? `<div class="kmaster"><div style="display:grid;gap:6px;flex:1 1 320px"><label class="label" for="kit-master">Master Drive folder (one link with everything inside)</label>
        <input class="field" type="url" id="kit-master" data-blur="kit-profile" data-f="masterFolder" value="${esc(p.masterFolder || '')}" placeholder="https://drive.google.com/drive/folders/…"></div>
        ${p.masterFolder ? `<a class="btn primary" href="${esc(p.masterFolder)}" target="_blank" rel="noopener">📁 Open ↗</a>` : ''}</div>`
    : p.masterFolder ? `<div class="kmaster"><div><b>All files for this client in one folder</b><p class="muted" style="margin:2px 0 0;font-size:.88rem">Open it and use Download to get everything in one go.</p></div>
        <a class="btn primary" href="${esc(p.masterFolder)}" target="_blank" rel="noopener">📁 Open master folder ↗</a></div>` : '';
  return `<div class="kit stack">${head}${master}
    <div class="kit-grid">${briefPanel(p, edit)}${brandPanel(p, edit)}</div>
    ${assetsPanel(A, edit)}</div>`;
}
function briefPanel(p, edit) {
  const { esc } = H();
  if (edit) return `<div class="panel kbrief"><h2>Brief</h2>${FIELDS.map(([k, l, ph]) => `<div class="kfield">
      <label class="label" for="kit-${k}">${l}</label>
      <textarea class="field" id="kit-${k}" rows="2" data-blur="kit-profile" data-f="${k}" placeholder="${esc(ph)}">${esc(p[k] || '')}</textarea></div>`).join('')}
    <p class="muted" style="font-size:.82rem;margin:0">Saves when you click outside a box.</p></div>`;
  const rows = FIELDS.filter(([k]) => p[k]);
  return `<div class="panel kbrief"><h2>Brief</h2>${rows.map(([k, l]) => `<div class="kread ${k === 'dos' ? 'do' : k === 'donts' ? 'dont' : ''}"><span class="label">${l}</span><p>${esc(p[k])}</p></div>`).join('')
    || `<p class="muted">The admin hasn't written the brief yet.</p>`}</div>`;
}
function brandPanel(p, edit) {
  const { S, esc } = H(), cols = p.colors || [], cd = S.ui.kitColor || (S.ui.kitColor = { name: '', hex: '#00d23b' });
  const sw = cols.map((c, i) => `<div class="kcolor"><button class="kswatch" data-act="kit-copy" data-text="${esc(c.hex)}" title="Copy ${esc(c.hex)}" style="background:${esc(c.hex)}"></button>
      <span><b>${esc(c.name || 'Colour')}</b><small>${esc(c.hex.toUpperCase())}</small></span>
      ${edit ? `<button class="btn sm ghost" data-act="kit-color-del" data-i="${i}" aria-label="Remove ${esc(c.name || c.hex)}">✕</button>` : ''}</div>`).join('');
  return `<div class="panel kbrand"><h2>Brand</h2>
    <div style="display:grid;gap:8px"><span class="label">Colours${cols.length ? ' · click to copy' : ''}</span>
      <div class="kcolors">${sw || `<p class="muted" style="margin:0">${edit ? 'No colours yet.' : 'No brand colours added.'}</p>`}</div>
      ${edit ? `<div class="kcadd"><input type="color" id="kit-chex" data-model="kitColor.hex" value="${esc(cd.hex)}" aria-label="Pick colour">
        <input class="field mono" id="kit-chex-t" data-model="kitColor.hex" value="${esc(cd.hex)}" maxlength="7" aria-label="Hex code" style="width:96px">
        <input class="field" id="kit-cname" data-model="kitColor.name" value="${esc(cd.name)}" placeholder="Name, e.g. Primary green">
        <button class="btn sm" data-act="kit-color-add">Add colour</button></div>` : ''}</div>
    <div class="kfield"><label class="label" for="kit-fonts">Fonts</label>
      ${edit ? `<input class="field" id="kit-fonts" data-blur="kit-profile" data-f="fonts" value="${esc(p.fonts || '')}" placeholder="e.g. Montserrat ExtraBold for captions, Open Sans for body">`
        : `<p style="margin:0">${esc(p.fonts || '—')}</p>`}</div>
    ${logoPreview()}</div>`;
}
function logoPreview() {
  const { esc } = H();
  const logos = K.data.assets.filter(a => a.kind === 'logo' && thumbOf(a.url)).slice(0, 4);
  if (!logos.length) return '';
  return `<div style="display:grid;gap:8px"><span class="label">Logo</span><div class="klogos">${logos.map(a =>
    `<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.label)}"><img src="${esc(thumbOf(a.url))}" alt="${esc(a.label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></a>`).join('')}</div></div>`;
}
function assetsPanel(A, edit) {
  const { S, esc } = H(), d = S.ui.kitAdd || (S.ui.kitAdd = { kind: 'broll', label: '', url: '', note: '' });
  const groups = KINDS.map(k => [k, A.filter(a => a.kind === k[0])]).filter(g => g[1].length);
  const add = edit ? `<div class="kadd">
      <div class="kfield"><label class="label" for="kit-akind">Type</label><select class="field" id="kit-akind" data-model="kitAdd.kind" style="width:100%">${KINDS.map(([k, l]) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="kfield"><label class="label" for="kit-alabel">Name</label><input class="field" id="kit-alabel" data-model="kitAdd.label" value="${esc(d.label)}" placeholder="e.g. Office B-roll, Oct shoot"></div>
      <div class="kfield"><label class="label" for="kit-aurl">Link</label><input class="field" type="url" id="kit-aurl" data-model="kitAdd.url" value="${esc(d.url)}" placeholder="https://drive.google.com/…"></div>
      <div class="kfield kwide"><label class="label" for="kit-anote">Note for the editor (optional)</label><input class="field" id="kit-anote" data-model="kitAdd.note" value="${esc(d.note)}" placeholder="e.g. Use clips 3–8 for hooks, skip the blurry ones"></div>
      <button class="btn primary" data-act="kit-add" ${K.busy ? 'disabled aria-busy="true"' : ''}>${K.busy ? 'Adding…' : 'Add to kit'}</button>
    </div>` : '';
  return `<div class="panel kassets"><div class="sec-h" style="padding:0;border:0"><h2>Files & links</h2><span class="mono muted">${A.length}</span></div>
    ${add}
    ${groups.map(([[k, l, ic], xs]) => `<section><div class="kgroup-h"><span class="kic">${ic}</span><h3>${l}</h3><span class="mono muted">${xs.length}</span></div>
      <div class="klist">${xs.map(a => K.editing === a.id ? editCard(a) : assetCard(a, edit)).join('')}</div></section>`).join('')
      || `<p class="muted">${edit ? 'No files yet. Paste Drive links for photos, client videos, B-roll, logo and music above.' : 'The admin hasn\'t added any files yet.'}</p>`}</div>`;
}
function assetCard(a, edit) {
  const { esc } = H(), th = thumbOf(a.url), ic = kindOf(a.kind)[2], armed = K.armed === a.id;
  const did = driveId(a.url), dl = did ? `https://drive.google.com/uc?export=download&id=${did}` : '';
  return `<div class="kasset">
    <a class="kthumb" href="${esc(a.url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><span>${isFolder(a.url) ? '📁' : ic}</span>${th ? `<img src="${esc(th)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</a>
    <div class="kmeta"><b>${esc(a.label)}</b>${a.note ? `<span class="knote">${esc(a.note)}</span>` : ''}<span class="mono muted khost">${esc(hostOf(a.url))}${isFolder(a.url) ? ' · folder' : ''}</span></div>
    <div class="ctrls">${dl ? `<a class="btn sm primary" href="${esc(dl)}" target="_blank" rel="noopener">⬇ Download</a>` : ''}<a class="btn sm" href="${esc(a.url)}" target="_blank" rel="noopener">${isFolder(a.url) ? 'Open folder ↗' : 'Open ↗'}</a><button class="btn sm ghost" data-act="kit-copy" data-text="${esc(a.url)}">Copy link</button>
      ${edit ? `<button class="btn sm ghost" data-act="kit-edit" data-id="${esc(a.id)}">Edit</button><button class="btn sm ${armed ? 'danger armed' : 'ghost'}" data-act="kit-del" data-id="${esc(a.id)}">${armed ? 'Confirm delete' : 'Delete'}</button>` : ''}</div></div>`;
}
function editCard(a) {
  const { S, esc } = H(), d = S.ui.kitEdit;
  return `<div class="kasset kediting">
    <div class="kfield kwide"><label class="label" for="kit-ekind">Type</label><select class="field" id="kit-ekind" data-model="kitEdit.kind" style="width:100%">${KINDS.map(([k, l]) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="kfield kwide"><label class="label" for="kit-elabel">Name</label><input class="field" id="kit-elabel" data-model="kitEdit.label" value="${esc(d.label)}"></div>
    <div class="kfield kwide"><label class="label" for="kit-eurl">Link</label><input class="field" type="url" id="kit-eurl" data-model="kitEdit.url" value="${esc(d.url)}"></div>
    <div class="kfield kwide"><label class="label" for="kit-enote">Note</label><input class="field" id="kit-enote" data-model="kitEdit.note" value="${esc(d.note)}"></div>
    <div class="ctrls"><button class="btn sm primary" data-act="kit-edit-save" ${K.busy ? 'disabled' : ''}>Save</button><button class="btn sm ghost" data-act="kit-edit-cancel">Cancel</button></div></div>`;
}
function strip() {
  ensure();
  if (!K.data) return '';
  const p = K.data.profile || {}, n = K.data.assets.length, brief = FIELDS.some(([k]) => p[k]);
  if (!n && !brief && !p.masterFolder) return '';
  return `<div class="kstrip"><span class="kic">✦</span><div><b>Client kit</b><span class="muted">${[brief ? 'Brief & brand' : '', n ? n + ' file link' + (n === 1 ? '' : 's') : ''].filter(Boolean).join(' · ')}. Check it before you edit.</span></div>
    <div class="ctrls">${p.masterFolder ? `<a class="btn sm" href="${H().esc(p.masterFolder)}" target="_blank" rel="noopener">📁 Files ↗</a>` : ''}<button class="btn sm primary" data-act="kit-open">Open client kit</button></div></div>`;
}

/* ---------- events ---------- */
async function blur(a, el) {
  if (a !== 'kit-profile' || !K.data) return;
  const f = el.dataset.f, v = el.value.trim(), p = K.data.profile || (K.data.profile = {});
  if ((p[f] || '') === v) return;
  if (f === 'masterFolder' && v && !/^https:\/\/\S+$/i.test(v)) { H().toast('Paste a full link that starts with https://', true); return; }
  p[f] = v; cacheSet(); H().render();
  await save('profile-set', { ws: K.ws, patch: { [f]: v } }, 'Saved.');
}
async function click(a, t) {
  const { S } = H(), d = t.dataset;
  switch (a) {
    case 'kit-open': S.ui.tab = 'kit'; H().render(); window.scrollTo(0, 0); return;
    case 'kit-retry': K.err = ''; H().render(); ensure(true); return;
    case 'kit-copy': H().copyText(d.text || '', 'Copied.'); return;
    case 'kit-copy-all': H().copyText(allText(), 'All links copied. Paste them anywhere.'); return;
    case 'kit-color-add': {
      const c = S.ui.kitColor || {}, hex = String(c.hex || '').trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(hex)) { H().toast('Use a hex code like #00D23B.', true); return; }
      const colors = [...(K.data.profile.colors || []), { name: String(c.name || '').trim(), hex }];
      K.data.profile.colors = colors; S.ui.kitColor = { name: '', hex }; H().render();
      await save('profile-set', { ws: K.ws, patch: { colors } }, 'Colour added.'); return;
    }
    case 'kit-color-del': {
      const colors = (K.data.profile.colors || []).filter((_, i) => i !== Number(d.i));
      K.data.profile.colors = colors; H().render();
      await save('profile-set', { ws: K.ws, patch: { colors } }); return;
    }
    case 'kit-add': {
      const x = S.ui.kitAdd || {};
      if (!/^https:\/\/\S+$/i.test(String(x.url || '').trim())) { H().toast('Paste a full link that starts with https://', true); document.getElementById('kit-aurl')?.focus(); return; }
      if (K.busy) return;
      K.busy = true; H().render();
      const ok = await save('asset-add', { ws: K.ws, kind: x.kind, label: String(x.label || '').trim() || kindOf(x.kind)[1], url: x.url.trim(), note: String(x.note || '').trim() }, 'Added to the kit.');
      K.busy = false;
      if (ok) S.ui.kitAdd = { kind: x.kind, label: '', url: '', note: '' };
      H().render(); return;
    }
    case 'kit-edit': {
      const a0 = K.data.assets.find(x => x.id === d.id); if (!a0) return;
      K.editing = a0.id; S.ui.kitEdit = { kind: a0.kind, label: a0.label, url: a0.url, note: a0.note }; H().render(); return;
    }
    case 'kit-edit-cancel': K.editing = null; H().render(); return;
    case 'kit-edit-save': {
      const x = S.ui.kitEdit || {};
      if (!/^https:\/\/\S+$/i.test(String(x.url || '').trim())) { H().toast('Paste a full link that starts with https://', true); return; }
      K.busy = true; H().render();
      const ok = await save('asset-update', { id: K.editing, kind: x.kind, label: String(x.label || '').trim(), url: x.url.trim(), note: String(x.note || '').trim() }, 'Saved.');
      K.busy = false; if (ok) K.editing = null; H().render(); return;
    }
    case 'kit-del': {
      if (K.armed !== d.id) { const id = d.id; K.armed = id; H().render(); setTimeout(() => { if (K.armed === id) { K.armed = null; H().render(); } }, 4000); return; }
      K.armed = null; K.data.assets = K.data.assets.filter(x => x.id !== d.id); H().render();
      await save('asset-delete', { id: d.id }, 'Removed from the kit.'); return;
    }
  }
}

window.KIT = { view, strip, click, blur, ensure };
})();
