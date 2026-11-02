// Helpers shared by the page and the service worker.
const DAY = 864e5;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function agoText(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday() - d.getTime()) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 30) {
    const w = Math.round(days / 7);
    return w + (w === 1 ? ' week ago' : ' weeks ago');
  }
  if (days < 365) {
    const m = Math.round(days / 30);
    return m + (m === 1 ? ' month ago' : ' months ago');
  }
  const y = Math.round(days / 365);
  return y + (y === 1 ? ' year ago' : ' years ago');
}

// "Happy" = starred, a win, a good/great mood, or a note from the gift-giver.
function isHappy(e) {
  return !!(e.starred || e.kind === 'win' || (e.mood || 0) >= 4 || e.gift);
}

// Entries that are worth bringing back: older than today (or from the gift), with some content.
function memoryPool(entries, happyOnly) {
  const t = startOfToday();
  return entries.filter(
    e => (e.created < t || e.gift) && (!happyOnly || isHappy(e)) && (e.text || e.photo)
  );
}

function pickRandom(list, avoidId) {
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter(x => x.id !== avoidId) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

// What a "remember this?" notification says. Used by the page (test) and the service worker.
function pingContent(e) {
  const ago = agoText(e.created).toLowerCase();
  const from = (typeof GIFT !== 'undefined' && GIFT.fromName) || 'someone who likes you';
  let title;
  if (e.gift) title = '💌 A little note from ' + from;
  else if (e.kind === 'win') title = '🌟 You were proud of this (' + ago + ')';
  else if (e.kind === 'keep') title = '📌 You saved this ' + ago;
  else title = '💛 You wrote this ' + ago;

  let body = (e.text || '').trim();
  if (body.length > 140) body = body.slice(0, 137).trimEnd() + '…';
  if (!body) body = '📷 A moment you wanted to keep';

  const options = {
    body,
    icon: 'icons/icon-192.png',
    tag: 'memory',
    data: { id: e.id },
  };
  if (e.photo) options.image = e.photo;
  return { title, options };
}
