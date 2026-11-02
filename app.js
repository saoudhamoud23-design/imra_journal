'use strict';

/* ============ tiny helpers ============ */
const $ = (s, r = document) => r.querySelector(s);

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) n.append(kid);
  return n;
}

const APP = typeof GIFT !== 'undefined' ? GIFT : {};
const pad2 = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtLong = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtFull = ts => new Date(ts).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const monthLabel = ts => new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;
const fromName = () => APP.fromName || 'me';

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ constants + state ============ */
const MOODS = [
  { v: 1, e: '😔', l: 'Rough' },
  { v: 2, e: '😕', l: 'Meh' },
  { v: 3, e: '🙂', l: 'Okay' },
  { v: 4, e: '😊', l: 'Good' },
  { v: 5, e: '🥰', l: 'Wonderful' },
];
const KINDS = {
  note: { icon: '📝', label: 'Thought', ph: 'What’s on your mind today?' },
  win: { icon: '🌟', label: 'Win', ph: 'Something you’re proud of, big or small…' },
  keep: { icon: '📌', label: 'Keep', ph: 'Something you don’t want to forget…' },
};
const TABS = [
  ['today', '🏡', 'Today'],
  ['journal', '📖', 'Journal'],
  ['wins', '🌟', 'Wins'],
  ['keep', '📌', 'Keep'],
  ['me', '⚙️', 'Me'],
];
const DEFAULTS = {
  remind: false, freq: 'daily', from: 9, to: 21, onlyHappy: true,
  pin: null, lastPing: 0, lastBackup: 0, dismissedRemind: false,
};
const S = { entries: [], moods: {}, settings: { ...DEFAULTS }, tab: 'today', filter: 'all', memId: null };
let deferredInstall = null;
let pendingOpenId = null;

const sorted = () => [...S.entries].sort((a, b) => b.created - a.created);
const moodOf = v => MOODS.find(m => m.v === v);

async function loadState() {
  S.entries = await allEntries();
  S.moods = await getKV('moods', {});
  S.settings = { ...DEFAULTS, ...(await getKV('settings', {})) };
}
const saveMoods = () => setKV('moods', S.moods);
async function saveSettings() {
  // the service worker updates lastPing in the background; don't overwrite it with an older value
  const cur = await getKV('settings', {});
  S.settings.lastPing = Math.max(S.settings.lastPing || 0, cur.lastPing || 0);
  await setKV('settings', S.settings);
}

/* ============ photos ============ */
function fileToDataURL(file, max = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/* ============ first-run gift ============ */
async function seedGift() {
  if (await getKV('seeded', false)) return;
  let i = 0;
  for (const g of APP.entries || []) {
    let photo = null;
    if (g.photo) {
      try {
        const blob = await (await fetch(g.photo)).blob();
        photo = await fileToDataURL(blob);
      } catch (err) { /* photo missing: keep the text */ }
    }
    await putEntry({
      id: uid(), kind: g.kind || 'note', text: g.text || '', photo,
      mood: g.mood || null, starred: !!g.starred, gift: true,
      created: Date.now() - (g.daysAgo || 0) * 864e5 - i++ * 1000,
    });
  }
  await setKV('seeded', true);
}

/* ============ sheets (bottom panels) ============ */
let sheetEl = null;
function openSheet(content) {
  const inner = el('div', { class: 'sheet' }, content);
  if (sheetEl) { sheetEl.replaceChildren(inner); return; }
  sheetEl = el('div', { class: 'sheet-wrap', onclick: ev => { if (ev.target === sheetEl) closeSheet(); } }, inner);
  document.body.append(sheetEl);
  history.pushState({ sheet: true }, '');
  requestAnimationFrame(() => sheetEl && sheetEl.classList.add('in'));
}
function closeSheet() { if (sheetEl) history.back(); }
window.addEventListener('popstate', () => { if (sheetEl) { sheetEl.remove(); sheetEl = null; } });
const sheetHead = title => el('div', { class: 'sheet-head' },
  el('h2', { text: title }),
  el('button', { class: 'x-btn', type: 'button', 'aria-label': 'Close', onclick: closeSheet }, '✕'));

/* ============ shared widgets ============ */
function moodRow(selected, onPick, allowClear) {
  const row = el('div', { class: 'moods' });
  const paint = v => [...row.children].forEach(b => b.classList.toggle('on', Number(b.dataset.v) === v));
  MOODS.forEach(m => row.append(el('button', {
    type: 'button', class: 'mood-btn', 'data-v': m.v, 'aria-label': m.l, title: m.l,
    onclick: () => {
      selected = allowClear && selected === m.v ? null : m.v;
      paint(selected);
      onPick(selected);
    },
  }, m.e)));
  paint(selected);
  return row;
}

const switchEl = (checked, onchange) => el('label', { class: 'switch' },
  el('input', { type: 'checkbox', checked, onchange: ev => onchange(ev.target.checked) }),
  el('span', { class: 'slider' }));

function selectEl(options, value, onchange) {
  const s = el('select', { onchange: ev => onchange(ev.target.value) });
  options.forEach(([v, l]) => s.append(el('option', { value: v, selected: String(v) === String(value) }, l)));
  return s;
}

const fromTag = () => el('div', { class: 'from-tag', text: '💌 from ' + fromName() });

/* ============ views ============ */
function brightest() {
  const ym = dayKey(Date.now()).slice(0, 7);
  let best = null;
  for (const [k, v] of Object.entries(S.moods)) {
    if (k.startsWith(ym) && v >= 4 && (!best || v > best.v || (v === best.v && k > best.k))) best = { k, v };
  }
  return best;
}

function moodStrip() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const m = moodOf(S.moods[dayKey(d.getTime())]);
    days.push(el('div', { class: 'sd' },
      el('span', { class: 'sd-l', text: d.toLocaleDateString(undefined, { weekday: 'narrow' }) }),
      el('span', { class: 'sd-e', text: m ? m.e : '·' })));
  }
  return el('div', { class: 'strip', 'aria-label': 'Your last 7 days' }, days);
}

function memoryCard() {
  const pool = memoryPool(S.entries, S.settings.onlyHappy);
  let m = S.entries.find(e => e.id === S.memId);
  if (!m || !pool.includes(m)) {
    m = pickRandom(pool);
    S.memId = m ? m.id : null;
  }
  if (!m) {
    return el('section', { class: 'card empty' },
      el('h2', { text: 'Your happy moments will live here' }),
      el('p', { class: 'sub', text: 'Write a thought, log a win, or star something you love. They’ll come back to you from time to time.' }));
  }
  return el('section', { class: 'card memory' },
    el('div', { class: 'mem-top' }, el('h2', { text: 'Remember this?' }), el('span', { class: 'ago', text: agoText(m.created) })),
    m.gift && fromTag(),
    m.photo && el('img', { class: 'mem-photo', src: m.photo, alt: '', onclick: () => openEntry(m) }),
    m.text && el('p', { class: 'mem-text', text: m.text }),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => { const n = pickRandom(pool, m.id); S.memId = n ? n.id : null; render(); } }, 'Another ✨'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => openEntry(m) }, 'Open')));
}

function viewToday() {
  const now = new Date();
  const h = now.getHours();
  const hello = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const today = dayKey(now.getTime());
  const best = brightest();
  const wins = S.entries.filter(e => e.kind === 'win').length;
  const photos = S.entries.filter(e => e.photo).length;
  const showRemindPrompt = canNotify() && !S.settings.remind && !S.settings.dismissedRemind && Notification.permission !== 'denied';

  return [
    el('header', { class: 'hero' },
      el('p', { class: 'eyebrow', text: fmtLong(now.getTime()) }),
      el('h1', { text: hello + (APP.herName && APP.herName !== 'HER NAME' ? ', ' + APP.herName : '') })),

    el('section', { class: 'card' },
      el('h2', { text: 'How are you feeling today?' }),
      moodRow(S.moods[today], async v => {
        if (v) S.moods[today] = v; else delete S.moods[today];
        await saveMoods();
        render();
      }, true),
      moodStrip(),
      best && el('p', { class: 'bright', text: '✨ Your brightest day this month: ' + fmtShort(new Date(best.k + 'T12:00:00').getTime()) })),

    memoryCard(),

    showRemindPrompt && el('section', { class: 'card' },
      el('h2', { text: 'Want gentle reminders?' }),
      el('p', { class: 'sub', text: 'Now and then, a notification can bring back something good you wrote, saved or achieved.' }),
      el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', onclick: async () => { if (await enableReminders()) toast('Reminders on 💛'); render(); } }, 'Yes, please'),
        el('button', { class: 'btn ghost', type: 'button', onclick: async () => { S.settings.dismissedRemind = true; await saveSettings(); render(); } }, 'Not now'))),

    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', { text: S.entries.length }), el('span', { text: 'Entries' })),
      el('div', { class: 'stat' }, el('b', { text: wins }), el('span', { text: 'Wins' })),
      el('div', { class: 'stat' }, el('b', { text: photos }), el('span', { text: 'Photos' }))),
  ];
}

function entryCard(e) {
  const k = KINDS[e.kind] || KINDS.note;
  const m = moodOf(e.mood);
  return el('article', { class: 'entry', tabindex: '0', onclick: () => openEntry(e) },
    el('div', { class: 'e-top' },
      el('span', { text: fmtShort(e.created) }),
      el('span', { text: [e.starred ? '★' : '', m ? m.e : '', k.icon].filter(Boolean).join(' ') })),
    e.gift && fromTag(),
    e.photo && el('img', { class: 'e-photo', src: e.photo, alt: '', loading: 'lazy' }),
    e.text && el('p', { class: 'e-text', text: e.text }));
}

function viewJournal() {
  const filters = [['all', 'All'], ['fav', '★ Favourites'], ['photo', '📷 Photos'], ['happy', '😊 Happy']];
  const test = {
    all: () => true,
    fav: e => e.starred,
    photo: e => !!e.photo,
    happy: e => isHappy(e),
  }[S.filter];
  const list = sorted().filter(test);
  const out = [
    el('header', { class: 'hero' }, el('h1', { text: 'Journal' })),
    el('div', { class: 'chips' }, filters.map(([k, l]) =>
      el('button', { class: 'chip' + (S.filter === k ? ' on' : ''), type: 'button', onclick: () => { S.filter = k; render(); } }, l))),
  ];
  if (!list.length) {
    out.push(el('p', { class: 'empty-note', text: S.entries.length ? 'Nothing here yet.' : 'Your first page is waiting. Tap + to write it.' }));
    return out;
  }
  let last = '';
  for (const e of list) {
    const label = monthLabel(e.created);
    if (label !== last) { out.push(el('h2', { class: 'month', text: label })); last = label; }
    out.push(entryCard(e));
  }
  return out;
}

function viewWins() {
  const wins = sorted().filter(e => e.kind === 'win');
  const out = [
    el('header', { class: 'hero' },
      el('h1', { text: 'Little wins' }),
      el('p', { class: 'sub', text: wins.length ? `${wins.length} ${wins.length === 1 ? 'thing' : 'things'} to be proud of.` : 'Finished something? Got through a hard day? Put it here.' })),
  ];
  if (!wins.length) {
    out.push(el('div', { class: 'card empty' },
      el('p', { class: 'sub', text: 'Small counts too. Replying to that email, getting out of bed, trying something new.' }),
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn', type: 'button', onclick: () => openEditor(null, 'win') }, '🌟 Add a win'))));
    return out;
  }
  for (const e of wins) {
    out.push(el('article', { class: 'entry', tabindex: '0', onclick: () => openEntry(e) },
      el('div', { class: 'win-item' },
        el('span', { class: 'star', text: '🌟' }),
        el('div', {},
          e.gift && fromTag(),
          e.text && el('p', { class: 'e-text', text: e.text }),
          e.photo && el('img', { class: 'e-photo', src: e.photo, alt: '', loading: 'lazy', style: 'margin-top:8px' }),
          el('p', { class: 'win-date', text: fmtShort(e.created) })))));
  }
  return out;
}

function viewKeep() {
  const items = sorted().filter(e => e.kind === 'keep');
  const out = [
    el('header', { class: 'hero' },
      el('h1', { text: 'Keep' }),
      el('p', { class: 'sub', text: 'Things you don’t want to forget.' })),
  ];
  if (!items.length) {
    out.push(el('div', { class: 'card empty' },
      el('p', { class: 'sub', text: 'A quote, a recipe, a photo, a feeling. Save it here.' }),
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn', type: 'button', onclick: () => openEditor(null, 'keep') }, '📌 Save something'))));
    return out;
  }
  out.push(el('div', { class: 'grid' }, items.map(e =>
    el('div', { class: 'tile', tabindex: '0', onclick: () => openEntry(e) },
      e.photo && el('img', { src: e.photo, alt: '', loading: 'lazy' }),
      e.text && el('p', { text: e.text }),
      el('small', { text: fmtShort(e.created) })))));
  return out;
}

/* ---- Me ---- */
function viewMe() {
  const s = S.settings;
  const notif = canNotify();
  const on = notif && s.remind && Notification.permission === 'granted';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const hours = Array.from({ length: 24 }, (_, h) => [h, pad2(h) + ':00']);
  const update = async patch => { Object.assign(S.settings, patch); await saveSettings(); };

  const reminders = el('section', { class: 'card' },
    el('div', { class: 'row between' },
      el('div', {},
        el('h2', { text: 'Happy reminders' }),
        el('p', { class: 'sub', text: 'Every so often, a notification brings back something good from your own journal.' })),
      notif && switchEl(on, async v => {
        if (v) { if (await enableReminders()) toast('Reminders on 💛'); }
        else { await update({ remind: false }); await unregisterPeriodic(); }
        render();
      })),
    !notif && el('p', { class: 'fine', text: 'This browser can’t show notifications. Chrome on Android can.' }),
    on && el('div', {},
      el('div', { class: 'field' }, el('span', { text: 'How often' }),
        selectEl([['daily', 'Every day'], ['every2', 'Every couple of days'], ['weekly', 'About once a week']], s.freq, v => update({ freq: v }))),
      el('div', { class: 'field' }, el('span', { text: 'Not before' }),
        selectEl(hours, s.from, v => update({ from: Number(v) }))),
      el('div', { class: 'field' }, el('span', { text: 'Not after' }),
        selectEl(hours, s.to, v => update({ to: Number(v) }))),
      el('div', { class: 'field' }, el('span', { text: 'Only happy memories' }),
        switchEl(s.onlyHappy, v => update({ onlyHappy: v }))),
      el('div', { class: 'row' }, el('button', { class: 'btn ghost', type: 'button', onclick: testPing }, 'Send me a test')),
      el('p', { class: 'fine', text: 'Android decides the exact timing, so a reminder can show up a little earlier or later than you set. That’s normal.' })));

  const lock = el('section', { class: 'card' },
    el('h2', { text: 'Privacy' }),
    el('p', { class: 'sub', text: 'Your journal lives only on this phone. There’s no account and no server holding it.' }),
    el('div', { class: 'row' },
      s.pin
        ? [el('button', { class: 'btn ghost', type: 'button', onclick: openPinSetup }, 'Change PIN'),
           el('button', { class: 'btn danger', type: 'button', onclick: async () => { if (confirm('Remove the PIN lock?')) { await update({ pin: null }); render(); toast('PIN removed'); } } }, 'Remove PIN')]
        : el('button', { class: 'btn ghost', type: 'button', onclick: openPinSetup }, '🔒 Set a PIN lock')));

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', onchange: ev => { const f = ev.target.files[0]; if (f) importAll(f); ev.target.value = ''; } });
  const backup = el('section', { class: 'card' },
    el('h2', { text: 'Backup' }),
    el('p', { class: 'sub', text: 'If you ever change phones or clear Chrome’s data, a backup file is how you keep everything.' }),
    el('p', { class: 'fine', text: s.lastBackup ? 'Last backup: ' + fmtShort(s.lastBackup) : 'You haven’t made a backup yet.' }),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', type: 'button', onclick: exportAll }, '⬇️ Save a backup'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => importInput.click() }, '⬆️ Restore'),
      importInput));

  const install = !standalone && el('section', { class: 'card' },
    el('h2', { text: 'Add to your home screen' }),
    el('p', { class: 'sub', text: 'It works best as an app, and reminders need it.' }),
    deferredInstall
      ? el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } }, 'Install'))
      : el('p', { class: 'fine', text: 'In Chrome: tap the ⋮ menu, then “Install app” or “Add to Home screen”.' }));

  const danger = el('section', { class: 'card' },
    el('h2', { text: 'Start over' }),
    el('div', { class: 'row' }, el('button', { class: 'btn danger', type: 'button', onclick: eraseAll }, 'Erase everything')));

  return [
    el('header', { class: 'hero' }, el('h1', { text: 'Me' }), el('p', { class: 'sub', text: 'Made with 💛 by ' + fromName() })),
    install, reminders, lock, backup, danger,
  ];
}

/* ============ render ============ */
function render() {
  const views = { today: viewToday, journal: viewJournal, wins: viewWins, keep: viewKeep, me: viewMe };
  $('#view').replaceChildren(...views[S.tab]().filter(Boolean));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
  $('#fab').style.display = S.tab === 'me' ? 'none' : '';
}

function setTab(t) {
  S.tab = t;
  render();
  window.scrollTo(0, 0);
}

/* ============ entry viewer + editor ============ */
function openEntry(e) {
  const k = KINDS[e.kind] || KINDS.note;
  const m = moodOf(e.mood);
  openSheet([
    sheetHead(k.icon + ' ' + k.label),
    el('p', { class: 'v-meta', text: fmtFull(e.created) }),
    e.gift && fromTag(),
    e.photo && el('img', { class: 'v-photo', src: e.photo, alt: '' }),
    e.text && el('p', { class: 'v-text', text: e.text }),
    m && el('p', { class: 'v-mood', text: m.e + ' ' + m.l }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost', type: 'button', onclick: async () => { e.starred = !e.starred; await putEntry(e); render(); openEntry(e); } }, e.starred ? '★ Favourite' : '☆ Favourite'),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor(e) }, '✏️ Edit'),
      el('button', { class: 'btn danger', type: 'button', onclick: () => removeEntry(e) }, 'Delete')),
  ]);
}

async function removeEntry(e) {
  if (!confirm('Delete this entry? This can’t be undone.')) return;
  await delEntry(e.id);
  S.entries = S.entries.filter(x => x.id !== e.id);
  if (S.memId === e.id) S.memId = null;
  closeSheet();
  render();
  toast('Deleted');
}

function openEditor(entry, kind) {
  const d = entry
    ? { ...entry }
    : { id: uid(), kind: kind || 'note', text: '', photo: null, mood: null, created: Date.now(), starred: false };

  const ta = el('textarea', { class: 'paper', rows: '8', maxlength: '20000', placeholder: KINDS[d.kind].ph });
  ta.value = d.text;

  const kindBtns = Object.entries(KINDS).map(([k, v]) => el('button', {
    type: 'button', class: 'chip' + (d.kind === k ? ' on' : ''), 'data-k': k,
    onclick: () => {
      d.kind = k;
      kindBtns.forEach(b => b.classList.toggle('on', b.dataset.k === k));
      ta.placeholder = KINDS[k].ph;
    },
  }, v.icon + ' ' + v.label));

  const preview = el('div', { class: 'photo-prev' });
  const showPhoto = () => {
    preview.replaceChildren();
    if (d.photo) {
      preview.append(
        el('img', { src: d.photo, alt: '' }),
        el('button', { type: 'button', class: 'x', 'aria-label': 'Remove photo', onclick: () => { d.photo = null; showPhoto(); } }, '✕'));
    }
  };
  const file = el('input', {
    type: 'file', accept: 'image/*', class: 'hidden',
    onchange: async ev => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      try { d.photo = await fileToDataURL(f); showPhoto(); } catch (err) { toast('Couldn’t read that photo'); }
    },
  });
  showPhoto();

  const save = async () => {
    d.text = ta.value.trim();
    if (!d.text && !d.photo) { toast('Write something or add a photo first'); return; }
    await putEntry(d);
    const i = S.entries.findIndex(x => x.id === d.id);
    if (i >= 0) S.entries[i] = d; else S.entries.push(d);
    if (d.mood) { S.moods[dayKey(d.created)] = d.mood; await saveMoods(); }
    closeSheet();
    render();
    toast('Saved 💛');
  };

  openSheet([
    sheetHead(entry ? 'Edit' : 'New entry'),
    el('div', { class: 'chips' }, kindBtns),
    ta,
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => file.click() }, '📷 Add a photo'),
      file),
    preview,
    el('p', { class: 'label', text: 'How did this feel? (optional)' }),
    moodRow(d.mood, v => { d.mood = v; }, true),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', onclick: save }, 'Save')),
  ]);
  setTimeout(() => { if (!entry) ta.focus(); }, 250);
}

/* ============ reminders ============ */
async function enableReminders() {
  if (!canNotify()) { toast('This browser can’t show notifications'); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notifications are blocked. Allow them in Android Settings › Apps › Journal.');
    return false;
  }
  S.settings.remind = true;
  await saveSettings();
  await registerPeriodic();
  return true;
}

async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('memory-ping', { minInterval: 12 * 3600 * 1000 });
  } catch (err) { /* best effort: Chrome decides */ }
}

async function unregisterPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.unregister('memory-ping');
  } catch (err) { /* ignore */ }
}

async function testPing() {
  if (!canNotify() || Notification.permission !== 'granted') { toast('Turn reminders on first'); return; }
  const pick = pickRandom(memoryPool(S.entries, false)) || pickRandom(S.entries);
  if (!pick) { toast('Add an entry first'); return; }
  const reg = await navigator.serviceWorker.ready;
  const p = pingContent(pick);
  await reg.showNotification(p.title, p.options);
  toast('Sent. Check your notifications.');
}

/* ============ PIN lock ============ */
async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function openPinSetup() {
  const a = el('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: '4 to 6 digits', autocomplete: 'off' });
  const b = el('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: 'Same PIN again', autocomplete: 'off' });
  openSheet([
    sheetHead('PIN lock'),
    el('p', { class: 'sub', text: 'Asked when you open the app, and after it’s been away for a minute.' }),
    el('p', { class: 'label', text: 'New PIN' }), a,
    el('p', { class: 'label', text: 'Confirm' }), b,
    el('div', { class: 'actions' }, el('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        if (!/^\d{4,6}$/.test(a.value)) { toast('Use 4 to 6 digits'); return; }
        if (a.value !== b.value) { toast('The two PINs don’t match'); return; }
        const salt = uid();
        S.settings.pin = { salt, hash: await hashPin(a.value, salt), len: a.value.length };
        await saveSettings();
        closeSheet();
        render();
        toast('PIN set 🔒');
      },
    }, 'Save PIN')),
  ]);
}

function showLock() {
  return new Promise(resolve => {
    const pin = S.settings.pin;
    if (!pin || $('#lock')) { resolve(); return; }
    let val = '';
    const msg = el('p', { class: 'sub', text: 'Enter your PIN' });
    const dots = el('div', { class: 'dots' });
    const paint = () => dots.replaceChildren(...Array.from({ length: pin.len }, (_, i) => el('i', { class: i < val.length ? 'on' : '' })));
    const press = async k => {
      if (k === '⌫') val = val.slice(0, -1);
      else if (val.length < pin.len) val += k;
      paint();
      if (val.length !== pin.len) return;
      if (await hashPin(val, pin.salt) === pin.hash) { box.remove(); resolve(); return; }
      msg.textContent = 'Not quite. Try again.';
      box.classList.add('shake');
      setTimeout(() => box.classList.remove('shake'), 400);
      val = '';
      paint();
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    const box = el('div', { id: 'lock', class: 'full' },
      el('div', { class: 'lock-in' },
        el('div', { class: 'lock-ico', text: '🔒' }),
        el('h1', { text: APP.appName || 'My Little Journal' }),
        msg, dots,
        el('div', { class: 'pad' }, keys.map(k => k === '' ? el('span') : el('button', { type: 'button', onclick: () => press(k) }, k)))));
    document.body.append(box);
    paint();
  });
}

/* ============ welcome ============ */
function showWelcome() {
  return new Promise(resolve => {
    const lines = (APP.welcome || 'I made this little corner just for you.').split('\n').filter(Boolean);
    const box = el('div', { class: 'full' },
      el('div', { class: 'lock-in' },
        el('div', { class: 'lock-ico', text: '💌' }),
        APP.herName && APP.herName !== 'HER NAME' && el('p', { class: 'eyebrow', text: 'For ' + APP.herName }),
        el('h1', { text: APP.appName || 'My Little Journal' }),
        lines.map(t => el('p', { class: 'wtext', text: t })),
        APP.fromName && APP.fromName !== 'YOUR NAME' && el('p', { class: 'sign', text: '— ' + APP.fromName }),
        el('p', { class: 'fine', text: 'It’s just yours. Everything you write or save stays on this phone. There’s no account and no server, so nobody can read it remotely.' }),
        el('button', { class: 'btn block', type: 'button', onclick: async () => { await setKV('welcomed', true); box.remove(); resolve(); } }, 'Open my journal')));
    document.body.append(box);
  });
}

/* ============ backup / restore / erase ============ */
async function exportAll() {
  const data = { app: 'little-journal', version: 1, exported: new Date().toISOString(), entries: S.entries, moods: S.moods };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = el('a', { href: url, download: `journal-backup-${dayKey(Date.now())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  S.settings.lastBackup = Date.now();
  await saveSettings();
  render();
  toast('Backup saved to your downloads');
}

async function importAll(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'little-journal' || !Array.isArray(data.entries)) throw new Error('not a backup');
    const have = new Set(S.entries.map(e => e.id));
    let n = 0;
    for (const e of data.entries) {
      if (e && e.id && !have.has(e.id)) { await putEntry(e); S.entries.push(e); n++; }
    }
    S.moods = { ...(data.moods || {}), ...S.moods };
    await saveMoods();
    render();
    toast(n ? `Restored ${n} ${n === 1 ? 'entry' : 'entries'}` : 'Everything was already here');
  } catch (err) {
    toast('That doesn’t look like a journal backup');
  }
}

async function eraseAll() {
  if (!confirm('Erase every entry, photo and mood from this phone? This can’t be undone. (Tip: save a backup first.)')) return;
  for (const e of S.entries) await delEntry(e.id);
  S.entries = [];
  S.moods = {};
  S.memId = null;
  await saveMoods();
  render();
  toast('All clear. A fresh start.');
}

/* ============ start ============ */
function buildChrome() {
  document.title = APP.appName || 'My Little Journal';
  $('#tabs').append(...TABS.map(([t, icon, label]) =>
    el('button', { type: 'button', 'data-t': t, onclick: () => setTab(t) }, el('span', { class: 'i', text: icon }), label)));
  $('#fab').addEventListener('click', () => openEditor(null, { wins: 'win', keep: 'keep' }[S.tab] || 'note'));
}

function openById(id) {
  const e = S.entries.find(x => x.id === id);
  if (e) openEntry(e);
}

window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); deferredInstall = ev; if (S.tab === 'me') render(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; });

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.settings.pin && Date.now() - hiddenAt > 60000) showLock();
});

async function start() {
  buildChrome();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.open) { pendingOpenId = ev.data.open; if (!$('#lock')) { openById(pendingOpenId); pendingOpenId = null; } }
    });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  await seedGift();
  await loadState();

  const q = new URLSearchParams(location.search).get('m');
  if (q) { pendingOpenId = q; history.replaceState(null, '', location.pathname); }

  render();
  if (S.settings.pin) await showLock();
  if (!(await getKV('welcomed', false))) await showWelcome();

  if (S.settings.remind && canNotify() && Notification.permission === 'granted') registerPeriodic();
  if (pendingOpenId) { openById(pendingOpenId); pendingOpenId = null; }
}

start().catch(err => {
  console.error(err);
  document.body.prepend(el('p', { style: 'padding:24px', text: 'Something went wrong opening the journal. Try reloading.' }));
});
