// Script reader for Hook Studio imports. No AI: it reads labels, mapping tables and structure,
// splits CTAs off bodies, removes duplicate hooks and reports anything it is unsure about.
(() => {
const TYPES = ['PAIN', 'DESIRE', 'CURIOSITY', 'AUTHORITY', 'OBJECTION', 'STORY', 'PROOF', 'CONTRARIAN', 'CUSTOM'];

const PROMPT = `You are a senior direct-response strategist for Meta video ads in the Indian market.
I will paste ad script material below (Hinglish, Hindi or English). It can contain hooks, bodies, CTAs, production notes, and sometimes a table or list saying which hooks go with which body.

What each part is:
- HOOK: the opening line or lines that stop the scroll. A hook can be several lines, a dialogue or a scene; keep it whole.
- BODY: the middle of the ad (problem, intro, credibility, testimonial, solution).
- CTA: the closing ask (click, link, button, DM, comment, register, book, join). If a body ends with the ask, move that final paragraph into "ctas" and keep the rest in "bodies".

Rules:
1. Copy every hook, body and CTA EXACTLY as written: same words, spelling, emojis and line breaks. Never translate, rewrite, shorten, merge or fix grammar. Keep scene or production notes that belong to a hook inside that hook. Remove only labels such as "Hook 3:-", "Body 2:" or "CTA:".
2. Every hook must appear exactly ONCE in the whole answer. Never put the same hook in two angles. If the same hook text appears twice in my material, include it once. Two hooks with different wording are both kept, even if they are similar.
3. If my material says which hooks go with which body (a table, list or note), follow it exactly: one angle per body, containing exactly those hooks, that body and that body's CTA.
4. Otherwise group the hooks by persuasion angle using these types: PAIN, DESIRE, CURIOSITY, AUTHORITY, OBJECTION, STORY, PROOF, CONTRARIAN (CUSTOM only when none fits), and attach the body and CTA written for each angle. A body or CTA shared by all hooks goes in every angle.
5. Give each angle a short specific name (max 6 words) and a one-line "why".
6. Before answering, check: the number of hooks in your answer equals the number of hooks in my material, no hook appears twice, no body text sits inside a hook, and no CTA text sits inside a body.

Reply with ONLY valid JSON in exactly this shape, with no other text before or after it:
{"angles":[{"type":"PAIN","name":"Content takes too much time","why":"Calls out hours lost daily","hooks":["..."],"bodies":["..."],"ctas":["..."]}]}

MY MATERIAL:
`;

/* ---------- text helpers ---------- */
const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = s => new Set(norm(s).split(' ').filter(w => w.length > 1));
function similarity(a, b) {
  const A = words(a), B = words(b);
  if (A.size < 5 || B.size < 5) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
function tidy(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
const paras = text => tidy(text).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
const short = (s, n = 60) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const CTA_CUE = /\b(click|tap|link|button|neeche|niche|comment|dm|register|book|join|whatsapp|call now|learn more|sign ?up|apply now|download|buy now|order now|visit|swipe up|see you on the other side|form bhar|bio mein)\b/i;
const NOTE_PARA = /^(note|notes|editor note|direction|production note)\b|\bthis body\b/i;

function guessType(text) {
  const t = String(text || '').toLowerCase();
  if (/proof|testimonial|result|case stud/.test(t)) return 'PROOF';
  if (/\bstory\b|journey|kahani|scene/.test(t)) return 'STORY';
  if (/authority|stand ?out|trust|premium|brand|expert/.test(t)) return 'AUTHORITY';
  if (/myth|veham|contrarian|truth|galat|system nahi|wrong/.test(t)) return 'CONTRARIAN';
  if (/objection|expensive|mehenga|but i don/.test(t)) return 'OBJECTION';
  if (/pain|problem|dependent|depend|lakhon|waste|struggle|kuch nahi|nahi aa/.test(t)) return 'PAIN';
  if (/desire|dream|freedom|scale|grow/.test(t)) return 'DESIRE';
  if (/secret|curio|kyun|why/.test(t)) return 'CURIOSITY';
  return 'CUSTOM';
}
const typeFor = (title, body) => { const t = guessType(title); return t !== 'CUSTOM' || !body ? t : guessType(body); };
// Sorts a single hook by the persuasion signals in its words (weighted, no AI).
const RULES = {
  PROOF: [/testimonial/i, /\bresults?\b/i, /case study/i, /\bclients?\b/i, /helped (him|her|them|us)/i, /after working/i, /\d+\s*%/, /generate[d]? (over|more than)/i, /drop in cost/i, /journey with/i, /kahna tha/i],
  STORY: [/^person \d/im, /^\s*scene\s*[-:]/im, /^[A-Z][\w ]{1,24}\s*:-?\s/m, /\bek baar\b/i, /\bstory\b/i, /sochiye/i, /\bimagine\b/i],
  CURIOSITY: [/secret(ly)?/i, /kya ho agar/i, /what if/i, /\bdecode\b/i, /\bye \d+\b/i, /\breason\b/i, /\bkaise\b/i, /\bhow (to|i|we)\b/i, /\bsawal\b/i, /question for you/i],
  CONTRARIAN: [/veham/i, /\bmyth\b/i, /\bgalat\b/i, /\bwrong\b/i, /\bstop\b/i, /you think ki/i, /\bsach\b/i, /\btruth\b/i, /bas ek chiz nhi/i],
  OBJECTION: [/tum kya hi/i, /mehenga|expensive|costly/i, /time nahi|no time/i, /\bbut (i|we) already\b/i],
  AUTHORITY: [/\byears?\b.*\bexperience\b/i, /\bfounder\b/i, /worked with \d/i, /\bbillion\b/i, /\bexpert\b/i, /\bking\b/i, /\bleader\b/i],
  DESIRE: [/chahte ho/i, /\bwant\b/i, /\bpremium\b/i, /\bdream\b/i, /help you/i, /stand ?out/i, /\bgrow\b/i, /\bscale\b/i],
  PAIN: [/\bstill\b/i, /phir bhi/i, /nahi ho raha|nhi ho rahi|nhi aati|nahi aa/i, /problem/i, /struggl/i, /spending (lakhs|more than)/i, /dependent|depend karta/i, /\bband\b/i, /waste/i, /\bkami\b/i, /don'?t trust/i]
};
const WEIGHT = { PROOF: 1.4, STORY: 1.2, CURIOSITY: 1, CONTRARIAN: 1.3, OBJECTION: 1, AUTHORITY: 0.9, DESIRE: 0.8, PAIN: 1 };
function classify(text) {
  let best = 'PAIN', score = 0;
  for (const [t, res] of Object.entries(RULES)) {
    const s = res.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0) * WEIGHT[t];
    if (s > score) { score = s; best = t; }
  }
  return best;
}
const TYPE_NAME = { PAIN: 'Pain', DESIRE: 'Desire', CURIOSITY: 'Curiosity', AUTHORITY: 'Authority', OBJECTION: 'Objection', STORY: 'Story', PROOF: 'Proof', CONTRARIAN: 'Contrarian', CUSTOM: 'Custom' };
const cleanTitle = t => short(String(t || '').replace(/\([^)]*\)/g, '').replace(/[:\-–—]+\s*$/, ''), 60);

/* ---------- JSON answers ---------- */
function findJson(text) {
  let best = null;
  for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
    if (!/^\{\s*"angles"\s*:/.test(text.slice(i, i + 40))) continue;
    let depth = 0, str = false, escp = false;
    for (let k = i; k < text.length; k++) {
      const ch = text[k];
      if (str) { if (escp) escp = false; else if (ch === '\\') escp = true; else if (ch === '"') str = false; continue; }
      if (ch === '"') str = true;
      else if (ch === '{' || ch === '[') depth++;
      else if ((ch === '}' || ch === ']') && --depth === 0) { try { best = JSON.parse(text.slice(i, k + 1)); } catch {} break; }
    }
  }
  return best;
}
const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(s => tidy(s)).filter(Boolean);

/* ---------- plain scripts ---------- */
// "Hook 1-", "Hook 2:-", "Hook 21;-", "HOOK:", "H3:", "Body 1: Title", "CTA -", "Call to action:", "ANGLE: PAIN | name"
const LABEL = /^\s*(?:[#*>•]+\s*)?(?:\*\*)?\s*(angle|hook|body|cta|call[\s-]*to[\s-]*action|h|b|c)\s*#?\s*(\d{1,3}[a-z]?)?\s*(?:\*\*)?\s*(?:([:;.)\-–—]+)\s*(.*)|$)/i;
// "5, 9, 12, 15A", "Hooks 1-3", "#4 & #9" — a list of hook numbers (ranges allowed).
const LIST_CELL = /^\s*(?:hooks?\s*[:\-]?\s*)?#?\d{1,3}[a-z]?(?:\s*-\s*\d{1,3})?(?:\s*(?:,|&|and|\/)\s*#?\d{1,3}[a-z]?(?:\s*-\s*\d{1,3})?)*\s*\.?\s*$/i;
const TABLE_HEAD = /^\s*(?:hooks?\s+(?:sorted|mapped|grouped|matched)\b|(?:body|angle)\s*[\t|]\s*hooks?\b|[#*]*\s*(?:hook[\s-]*(?:to|→)[\s-]*body\s*)?mapping\b)/i;
// A heading on its own line ("HOOKS", "Bodies:", "**CTA**") starts a list of that kind.
const SECTION = /^\s*(?:[#*>•]+\s*)?(?:\*\*|__)?\s*(hooks|hook|bodies|body|ctas|cta|calls? to action)\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/i;
const LIST_ITEM = /^\s*(?:(\d{1,3}[a-z]?)\s*[.)]|[-•*])\s+(.*)$/i;
function refs(cell) {
  const out = [];
  for (const tok of cell.replace(/hooks?/ig, '').split(/,|&|\band\b|\//i)) {
    const t = tok.trim().replace(/^#/, '').replace(/\.$/, '').toUpperCase(); if (!t) continue;
    const r = t.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
    if (r) { for (let n = +r[1]; n <= +r[2] && n - r[1] < 60; n++) out.push(String(n)); } else out.push(t);
  }
  return out;
}

function readLabel(line) {
  const m = line.match(LABEL);
  if (!m) return null;
  let kind = m[1].toLowerCase(); const num = m[2] ? m[2].toUpperCase() : '';
  if (kind.length === 1 && !num) return null;            // a bare "H" or "C" is just text
  if (m[3] === undefined && !num && !/^(angle|hook|body|cta)$/i.test(line.trim().replace(/[*#\s]/g, ''))) return null;
  kind = kind === 'h' ? 'hook' : kind === 'b' ? 'body' : kind === 'c' || kind.startsWith('call') ? 'cta' : kind;
  return { kind, num, rest: (m[4] || '').trim() };
}
function mappingRow(line) {
  const cells = line.split(/\t|\s\|\s|\||→|->|=>/).map(c => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;
  const head = cells[0].match(/^\s*(?:[#*>•]+\s*)?(?:body|b|angle)\s*#?\s*(\d{1,3})/i);
  const cell = cells.slice(1).find(c => LIST_CELL.test(c) && /\d/.test(c));
  if (!head || !cell) return null;
  return { body: head[1], hooks: refs(cell),
    title: cells[0].replace(/^\s*(?:body|b|angle)\s*#?\s*\d{1,3}\s*[:\-–—.]*\s*/i, '') };
}

function readPlain(text, report) {
  const lines = tidy(text).split('\n');
  const blocks = [], map = [];
  let cur = null, table = false, tableBody = null, section = null, blank = false;
  for (const raw of lines) {
    const line = raw.replace(/\u00a0/g, ' ');
    if (!line.trim()) { blank = true; if (cur) cur.lines.push(''); continue; }
    const wasBlank = blank; blank = false;
    if (TABLE_HEAD.test(line)) { table = true; cur = null; section = null; continue; }
    const row = mappingRow(line);
    if (row) { map.push(row); tableBody = row.body; cur = null; section = null; continue; }
    const sec = line.match(SECTION);
    if (sec) {
      const w = sec[1].toLowerCase();
      section = w.startsWith('hook') ? 'hook' : w.startsWith('bod') ? 'body' : 'cta';
      cur = null; table = false; continue;
    }
    const lab = readLabel(line);
    if (table) {
      if (lab && lab.kind === 'body' && lab.num) { tableBody = lab.num.replace(/\D/g, ''); continue; }
      if (LIST_CELL.test(line) && tableBody) { map.push({ body: tableBody, hooks: refs(line), title: '' }); continue; }
      if (!lab || lab.kind !== 'hook') continue;
      table = false;
    }
    if (lab) { section = null; cur = { ...lab, lines: [] }; blocks.push(cur); continue; }
    if (section) {
      // Under a "HOOKS" heading every numbered/bulleted line (or, for hooks, every paragraph) is its own item.
      const li = line.match(LIST_ITEM);
      if (li || !cur || (wasBlank && section !== 'body')) {
        cur = { kind: section, num: li && li[1] ? li[1].toUpperCase() : '', rest: li ? li[2].trim() : line.trim(), lines: [], listed: true };
        blocks.push(cur);
      } else cur.lines.push(line);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  // Turn blocks into items. A short line after "Body 1:" followed by paragraphs is the body's title.
  const items = [];
  for (const b of blocks) {
    const tail = tidy(b.lines.join('\n')), whole = tidy([b.rest, ...b.lines].join('\n'));
    let title = '', body = '';
    if (b.kind === 'angle') { title = b.rest; body = tail; }
    // Only a numbered label carries a title ("Body 1: Ads pe dependent"); "BODY: Main aapko…" is already the text.
    else if (b.kind !== 'hook' && b.num && !b.listed && b.rest && tail && b.rest.length <= 90 && !/[.?!।"”]$/.test(b.rest)) { title = b.rest; body = tail; }
    else body = whole;
    if (!body && b.kind !== 'angle') continue;
    items.push({ kind: b.kind, num: b.num, title, text: body });
  }
  // Same label used twice ("Hook 15" and "Hook 15") becomes 15A and 15B, the way people refer to them.
  const seen = {};
  for (const it of items) if (it.kind === 'hook' && it.num) (seen[it.num] ||= []).push(it);
  for (const [n, xs] of Object.entries(seen)) if (xs.length > 1 && /^\d+$/.test(n)) {
    xs.forEach((it, i) => { it.num = n + String.fromCharCode(65 + i); });
    report.warnings.push(`"Hook ${n}" was used ${xs.length} times. Read them as ${xs.map(x => 'H' + x.num).join(', ')}.`);
  }
  let hookIdx = 0; const allNumbered = items.filter(i => i.kind === 'hook').every(i => i.num);
  for (const it of items) if (it.kind === 'hook') { hookIdx++; it.label = allNumbered ? 'H' + it.num : 'H' + hookIdx; }
  return { items, map };
}

function splitBody(text, report, name) {
  const ps = paras(text);
  const notes = ps.filter(p => NOTE_PARA.test(p));
  notes.forEach(n => report.warnings.push(`Left out a note from ${name}: "${short(n, 70)}"`));
  const keep = ps.filter(p => !NOTE_PARA.test(p));
  if (keep.length >= 2 && CTA_CUE.test(keep[keep.length - 1])) return { body: keep.slice(0, -1).join('\n\n'), cta: keep[keep.length - 1] };
  return { body: keep.join('\n\n'), cta: '' };
}

function groupPlain({ items, map }, report) {
  const hooks = items.filter(i => i.kind === 'hook'), bodies = items.filter(i => i.kind === 'body'), ctas = items.filter(i => i.kind === 'cta');
  report.found = { hooks: hooks.length, bodies: bodies.length, ctas: ctas.length };
  const prep = (b, i) => {
    const name = 'Body ' + (b.num || i + 1);
    const s = ctas.length ? { body: splitBody(b.text, report, name).body, cta: '' } : splitBody(b.text, report, name);
    if (!ctas.length && s.cta) report.notes.push(`Split the last paragraph of ${name} into its CTA.`);
    return { ...b, body: s.body, cta: s.cta };
  };
  const B = bodies.map(prep);
  if (!ctas.length) report.found.ctas = B.filter(b => b.cta).length;
  const ctaFor = i => ctas.length === B.length ? [ctas[i].text] : ctas.length ? ctas.map(c => c.text) : (B[i].cta ? [B[i].cta] : []);
  const angle = (name, type, why, hs, bs, cs) => ({ type, name, why, hooks: hs.map(h => ({ t: h.text, label: h.label })), bodies: bs, ctas: cs });

  // 1) ANGLE: lines decide the folders, in order.
  if (items.some(i => i.kind === 'angle')) {
    const out = []; let a = null;
    for (const it of items) {
      if (it.kind === 'angle') {
        const parts = it.title.split('|'); let type = parts[0].trim().toUpperCase(), name = parts.slice(1).join('|').trim();
        if (!TYPES.includes(type)) { type = guessType(it.title); name = it.title; }
        a = { type, name: name || type, why: '', hooks: [], bodies: [], ctas: [] }; out.push(a); continue;
      }
      if (!a) { a = { type: 'CUSTOM', name: 'Imported hooks', why: '', hooks: [], bodies: [], ctas: [] }; out.push(a); }
      if (it.kind === 'hook') a.hooks.push({ t: it.text, label: it.label });
      else if (it.kind === 'body') { const s = ctas.length ? { body: it.text } : splitBody(it.text, report, 'a body'); a.bodies.push(s.body); if (s.cta) a.ctas.push(s.cta); }
      else if (it.kind === 'cta') a.ctas.push(it.text);
    }
    return out;
  }
  // 2) A "which hooks go with which body" table.
  if (map.length && B.length) {
    const byLabel = new Map(hooks.map(h => [h.label.slice(1), h]));
    const used = new Set(), out = [], missing = [];
    for (const row of map) {
      const bi = B.findIndex(b => (b.num || '').replace(/\D/g, '') === row.body);
      if (bi < 0) { report.warnings.push(`The table mentions Body ${row.body}, but there is no Body ${row.body} in the script.`); continue; }
      const hs = [];
      for (const ref of row.hooks) {
        const matches = byLabel.has(ref) ? [byLabel.get(ref)] : hooks.filter(h => h.label.slice(1).replace(/[A-Z]$/, '') === ref);
        if (!matches.length) missing.push(ref);
        for (const h of matches) { if (used.has(h)) report.warnings.push(`H${h.label.slice(1)} is listed under more than one body. Kept it in the first one only.`); else { used.add(h); hs.push(h); } }
      }
      const b = B[bi], title = cleanTitle(b.title || row.title) || 'Body ' + row.body;
      out.push(angle(title, typeFor(title, b.body), `Hooks matched to Body ${row.body} in your table`, hs, [b.body], ctaFor(bi)));
    }
    if (missing.length) report.warnings.push(hooks.length ? `The table lists hook${missing.length === 1 ? '' : 's'} ${missing.join(', ')}, but ${missing.length === 1 ? 'it is' : 'they are'} not in this paste.` : 'The table lists hooks, but this paste has no hooks. Paste the hooks and the bodies together so they can be matched.');
    const left = hooks.filter(h => !used.has(h));
    if (left.length) { report.warnings.push(`${left.length} hook${left.length === 1 ? ' is' : 's are'} not in the table (${left.map(h => h.label).join(', ')}). Put in "Unsorted hooks" with no body yet.`);
      out.push(angle('Unsorted hooks', 'CUSTOM', 'Not listed in the body table', left, [], [])); }
    const unusedB = B.filter((b, i) => !map.some(r => r.body === (b.num || String(i + 1)).replace(/\D/g, '')));
    unusedB.forEach(b => report.warnings.push(`Body ${b.num} is not used in the table.`));
    return out;
  }
  // 3) Full ads written one after another (hook(s), then body, then CTA) become one folder each.
  const firstBody = items.findIndex(i => i.kind === 'body'), lastHook = items.map(i => i.kind).lastIndexOf('hook');
  if (B.length > 1 && lastHook > firstBody) {
    const out = []; let hs = [], bs = [], cs = [], n = 0;
    const flush = () => { if (hs.length || bs.length) { n++; const t = bs[0] ? (B.find(b => b.text === bs[0].text)?.title || '') : ''; out.push(angle(cleanTitle(t) || 'Ad ' + n, typeFor(t, bs[0]?.body || ''), 'Written together in the script', hs, bs.map(b => b.body), cs.length ? cs : bs.map(b => b.cta).filter(Boolean))); } hs = []; bs = []; cs = []; };
    for (const it of items) {
      if (it.kind === 'hook') { if (bs.length || cs.length) flush(); hs.push(it); }
      else if (it.kind === 'body') bs.push(B[bodies.indexOf(it)]);
      else if (it.kind === 'cta') cs.push(it.text);
    }
    flush();
    report.notes.push('No body table found, so each group of hooks was matched to the body written right after it.');
    return out;
  }
  // 4) One set of hooks with one or more bodies.
  if (!hooks.length) return [];
  const bodyTexts = B.map(b => b.body), ctaTexts = ctas.length ? ctas.map(c => c.text) : B.map(b => b.cta).filter(Boolean);
  // Several hooks sharing one body (or none): sort them into angle folders by what each hook says.
  if (hooks.length >= 3 && B.length <= 1) {
    const by = new Map();
    for (const h of hooks) { const t = classify(h.text); if (!by.has(t)) by.set(t, []); by.get(t).push(h); }
    if (by.size > 1) {
      report.notes.push(`Sorted ${hooks.length} hooks into ${by.size} angle folders by what each hook says. Check them, and use "Move to" on any hook that belongs in another folder.`);
      if (!B.length) report.warnings.push('No body or CTA found. Videos are created once you add at least one body and one CTA to each folder.');
      return [...by.entries()].map(([t, hs]) => ({ ...angle(TYPE_NAME[t] + ' hooks', t, 'Auto-sorted by the words in each hook', hs, bodyTexts, ctaTexts), auto: true }));
    }
  }
  if (B.length > 1) report.warnings.push(`No table says which hooks go with which body, so every hook is paired with all ${B.length} bodies (${hooks.length * B.length * Math.max(1, ctaTexts.length)} videos). Untick bodies you don't want, or add a "Hooks sorted by body" table to the script.`);
  if (!B.length) report.warnings.push('No body or CTA found. Videos are created once you add at least one body and one CTA to the folder.');
  return [angle(B.length === 1 && B[0].title ? cleanTitle(B[0].title) : 'Imported hooks', B.length === 1 ? typeFor(B[0].title, B[0].body) : 'CUSTOM', '', hooks, bodyTexts, ctaTexts)];
}

/* ---------- checks shared by both paths ---------- */
function check(angles, ctx, report) {
  const existing = new Map((ctx.existing || []).map(e => [norm(e.text), e.angle]));
  const seen = new Map(); let dup = 0, old = 0;
  const allHooks = [];
  for (const a of angles) {
    for (const h of a.hooks) {
      const k = norm(h.t);
      if (!k) { h.on = false; continue; }
      if (seen.has(k)) { h.on = false; h.flag = `Duplicate of ${seen.get(k)}, left out`; dup++; continue; }
      seen.set(k, h.label ? `${h.label} in "${a.name}"` : `a hook in "${a.name}"`);
      if (existing.has(k)) { h.on = false; h.flag = `Already in folder "${existing.get(k)}", left out`; old++; continue; }
      if (h.t.length > 700 && CTA_CUE.test(paras(h.t).slice(-1)[0] || '')) h.flag = 'Very long and ends like a CTA. Check that no body text got into this hook.';
      allHooks.push({ h, a });
    }
    for (const kind of ['bodies', 'ctas']) {
      const s = new Set();
      a[kind] = a[kind].filter(it => { const k = norm(it.t); if (!k || s.has(k)) return false; s.add(k); return true; });
    }
    for (const b of a.bodies) if (a.hooks.some(h => h.on !== false && norm(h.t) === norm(b.t))) report.warnings.push(`In "${a.name}" the same text is both a hook and a body.`);
  }
  for (let i = 0; i < allHooks.length; i++) for (let j = i + 1; j < allHooks.length; j++) {
    const x = allHooks[i].h, y = allHooks[j].h;
    if (!y.flag && similarity(x.t, y.t) >= 0.85) y.flag = `Almost the same as ${x.label || 'another hook'}. Kept it; untick if it is a repeat.`;
  }
  for (const a of angles) if (a.hooks.some(h => h.on) && (!a.bodies.length || !a.ctas.length))
    report.warnings.push(`"${a.name}" has no ${!a.bodies.length ? 'body' : 'CTA'} yet, so it will make 0 videos until you add one.`);
  report.duplicates = dup; report.already = old;
  report.kept = angles.reduce((s, a) => s + a.hooks.filter(h => h.on).length, 0);
}

function parse(text, ctx = {}) {
  const report = { source: 'script', found: null, kept: 0, duplicates: 0, already: 0, warnings: [], notes: [] };
  const src = String(text || '');
  let angles;
  const j = findJson(src);
  if (j) {
    report.source = 'json';
    angles = (Array.isArray(j) ? j : j.angles || []).map((a, i) => {
      const type = TYPES.includes(String(a.type || '').toUpperCase()) ? String(a.type).toUpperCase() : 'CUSTOM';
      let bodies = list(a.bodies), ctas = list(a.ctas);
      if (!ctas.length && bodies.length) {
        const parts = bodies.map(b => splitBody(b, report, `angle ${i + 1}`));
        if (parts.some(p => p.cta)) { bodies = parts.map(p => p.body); ctas = [...new Set(parts.map(p => p.cta).filter(Boolean))]; report.notes.push(`Split the CTA off the body in "${a.name || 'angle ' + (i + 1)}".`); }
      }
      return { type, name: String(a.name || type).slice(0, 120), why: String(a.why || '').slice(0, 400),
        hooks: list(a.hooks).map((t, k) => ({ t, label: '' })), bodies, ctas };
    });
    let n = 0; angles.forEach(a => a.hooks.forEach(h => { h.label = 'H' + (++n); }));
    report.found = { hooks: n, bodies: angles.reduce((s, a) => s + a.bodies.length, 0), ctas: angles.reduce((s, a) => s + a.ctas.length, 0) };
  } else {
    if (/"angles"\s*:/.test(src)) throw new Error("That JSON is cut off or broken. Clear this box (Ctrl+A, Delete), copy Claude's answer once and paste it again.");
    const read = readPlain(src, report);
    if (read.items.length) angles = groupPlain(read, report);
    else {
      // No labels at all: one script. First paragraph = hook, last = CTA when it asks for an action, the rest = body.
      const ps = paras(src);
      angles = [];
      if (ps.length) {
        const hook = ps.shift(); let cta = '';
        if (ps.length > 1 && CTA_CUE.test(ps[ps.length - 1])) cta = ps.pop();
        const type = classify(hook);
        angles = [{ type, name: TYPE_NAME[type] + ' hook', why: 'Read as one script: first paragraph is the hook', hooks: [{ t: hook, label: 'H1' }], bodies: ps.length ? [ps.join('\n\n')] : [], ctas: cta ? [cta] : [] }];
        report.found = { hooks: 1, bodies: ps.length ? 1 : 0, ctas: cta ? 1 : 0 };
        report.notes.push('No "Hook / Body / CTA" labels found, so this was read as one ad: the first paragraph is the hook' + (cta ? ', the last is the CTA' : '') + '. Label your script to import many hooks at once.');
      }
    }
  }
  angles = angles.filter(a => a.hooks.length || a.bodies.length || a.ctas.length).map(a => ({
    on: true, type: a.type, name: a.name, why: a.why || '', existingId: '',
    hooks: a.hooks.map(h => ({ t: tidy(h.t), label: h.label || '', on: true })),
    bodies: a.bodies.map(t => ({ t: tidy(t), on: true })), ctas: a.ctas.map(t => ({ t: tidy(t), on: true }))
  }));
  const byName = new Map((ctx.angles || []).map(x => [norm(x.name), x.id]));
  for (const a of angles) if (byName.has(norm(a.name))) a.existingId = byName.get(norm(a.name));
  check(angles, ctx, report);
  return { angles, report };
}

/* ---------- AI sorting ---------- */
// Cut the paste into numbered pieces (H5, B1, C1… when labelled, otherwise paragraphs P1, P2…).
// The AI only answers with these ids, and the exact text is copied back from here.
function units(text) {
  const src = String(text || '');
  if (findJson(src)) return null;                          // Claude's JSON is already sorted
  const report = { source: 'ai', found: null, kept: 0, duplicates: 0, already: 0, warnings: [], notes: [] };
  const { items, map } = readPlain(src, report);
  const hooks = items.filter(i => i.kind === 'hook'), bodies = items.filter(i => i.kind === 'body'), ctas = items.filter(i => i.kind === 'cta');
  const list = [];
  if (hooks.length || bodies.length) {
    hooks.forEach(h => list.push({ id: h.label, kind: 'hook', text: h.text }));
    let c = 0;
    bodies.forEach((b, i) => {
      const id = 'B' + (b.num || i + 1);
      const s = ctas.length ? { body: splitBody(b.text, report, 'Body ' + (b.num || i + 1)).body, cta: '' } : splitBody(b.text, report, 'Body ' + (b.num || i + 1));
      list.push({ id, kind: 'body', title: cleanTitle(b.title), text: s.body });
      if (s.cta) list.push({ id: 'C' + (++c), kind: 'cta', text: s.cta });
    });
    ctas.forEach(x => list.push({ id: 'C' + (++c), kind: 'cta', text: x.text }));
  } else {
    paras(src).forEach((p, i) => list.push({ id: 'P' + (i + 1), kind: 'part', text: p }));
  }
  report.found = { hooks: hooks.length, bodies: bodies.length, ctas: list.filter(x => x.kind === 'cta').length };
  return { units: list.filter(x => x.text), map: map.map(m => ({ body: m.body, hooks: m.hooks })), report };
}
function fromAI(u, ai, ctx = {}) {
  const report = u.report, byId = new Map(u.units.map(x => [x.id, x]));
  const used = new Set();
  let angles = (ai.angles || []).map(a => ({
    on: true, type: TYPES.includes(a.type) ? a.type : 'CUSTOM', name: String(a.name || 'Angle').slice(0, 120), why: a.why || '', existingId: '',
    hooks: a.hooks.filter(id => byId.has(id)).map(id => { used.add(id); const x = byId.get(id); return { t: tidy(x.text), label: x.kind === 'hook' ? id : '', on: true }; }),
    bodies: a.bodies.filter(id => byId.has(id)).map(id => { used.add(id); return { t: tidy(byId.get(id).text), on: true }; }),
    ctas: a.ctas.filter(id => byId.has(id)).map(id => { used.add(id); return { t: tidy(byId.get(id).text), on: true }; })
  }));
  (ai.angles || []).forEach(a => (a.ignored || []).forEach(id => used.add(id)));
  // Nothing from the script may disappear: hooks the AI skipped go to "Unsorted hooks".
  const missed = u.units.filter(x => x.kind === 'hook' && !used.has(x.id));
  if (missed.length) {
    report.warnings.push(`The AI did not place ${missed.length} hook${missed.length === 1 ? '' : 's'} (${missed.map(x => x.id).join(', ')}). They are in "Unsorted hooks".`);
    angles.push({ on: true, type: 'CUSTOM', name: 'Unsorted hooks', why: 'Not placed by the AI', existingId: '', hooks: missed.map(x => ({ t: tidy(x.text), label: x.id, on: true })), bodies: [], ctas: [] });
  }
  const skipped = u.units.filter(x => x.kind === 'part' && !used.has(x.id));
  if (skipped.length) report.notes.push(`Left out ${skipped.length} paragraph${skipped.length === 1 ? '' : 's'} the AI read as notes: ${skipped.map(x => '"' + short(x.text, 40) + '"').join(', ')}.`);
  if (u.units.every(x => x.kind === 'part')) {
    let n = 0; angles.forEach(a => a.hooks.forEach(h => { h.label = 'H' + (++n); }));
    report.found = { hooks: n, bodies: angles.reduce((s, a) => s + a.bodies.length, 0), ctas: angles.reduce((s, a) => s + a.ctas.length, 0) };
  }
  angles = angles.filter(a => a.hooks.length || a.bodies.length || a.ctas.length);
  const byName = new Map((ctx.angles || []).map(x => [norm(x.name), x.id]));
  for (const a of angles) if (byName.has(norm(a.name))) a.existingId = byName.get(norm(a.name));
  report.source = 'ai';
  check(angles, ctx, report);
  return { angles, report };
}

// What gets saved: ticked items only, and a hook is never saved twice even if ticked in two folders.
// A hook's "to" is the folder it was moved to on the review screen (default: where it was read).
const target = (h, i) => (h.to === undefined || h.to === '' ? i : Number(h.to));
function payload(result) {
  const seen = new Set(), A = result.angles;
  return A.map((a, i) => ({ a, i })).filter(({ a }) => a.on).map(({ a, i }) => ({
    existingId: a.existingId || null, type: a.type, name: a.name, why: a.why,
    hooks: A.flatMap((s, si) => s.hooks.filter(h => h.on && target(h, si) === i))
      .filter(h => !seen.has(norm(h.t)) && seen.add(norm(h.t))).map(h => h.t),
    bodies: a.bodies.filter(x => x.on).map(x => x.t), ctas: a.ctas.filter(x => x.on).map(x => x.t)
  }));
}
// Videos the import will create: hooks landing in each ticked folder × its ticked bodies × CTAs.
function videoCount(result) {
  return payload(result).reduce((s, a) => s + a.hooks.length * a.bodies.length * a.ctas.length, 0);
}

function reportHtml(r, esc) {
  if (!r) return '';
  const f = r.found || { hooks: 0, bodies: 0, ctas: 0 };
  const parts = [`<b>Found ${f.hooks} hook${f.hooks === 1 ? '' : 's'}, ${f.bodies} bod${f.bodies === 1 ? 'y' : 'ies'}, ${f.ctas} CTA${f.ctas === 1 ? '' : 's'}</b>`,
    `${r.kept} hook${r.kept === 1 ? '' : 's'} will be added`];
  if (r.duplicates) parts.push(`${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} left out`);
  if (r.already) parts.push(`${r.already} already in this campaign`);
  return `<div class="imp-report ${r.warnings.length ? 'warn' : 'ok'}"><div>${parts.join(' · ')}</div>
    ${r.warnings.length ? `<ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.notes.length ? `<p class="muted">${r.notes.map(esc).join(' ')}</p>` : ''}</div>`;
}

const css = `.imp-report{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:10px;background:var(--surface-2);font-size:.88rem}
.imp-report.warn{border-left-color:var(--mari)}.imp-report ul{margin:0;padding-left:18px;display:grid;gap:3px}.imp-report p{margin:0;font-size:.82rem}
.pick .imp-label{font-family:var(--f-mono);font-size:.74rem;color:var(--muted);margin-right:6px}
.pick .imp-flag{display:block;margin-top:3px;font-style:normal;font-size:.78rem;color:var(--warn)}
.pick.flagged{opacity:.92}
.pick-row{display:flex;gap:8px;align-items:flex-start}.pick-row>.pick{flex:1;min-width:0}
.pick-row>.imp-move{flex:none;width:auto;max-width:44%;font-size:.8rem;padding:4px 6px}
@media (max-width:640px){.pick-row{flex-direction:column}.pick-row>.imp-move{max-width:100%;margin-left:26px}}`;
try { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); } catch {}

window.IMPORTER = { PROMPT, parse, payload, videoCount, reportHtml, norm, classify, units, fromAI };
})();
