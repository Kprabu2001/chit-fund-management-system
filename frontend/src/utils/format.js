// Display helpers: show chit amounts (1 Lakh, 1.5 Lakhs ...) instead of tier names / legacy codes.
// These only change what is DISPLAYED. Stored ticket IDs are untouched, so the backend keeps working.

const LEGACY_CODES = { BRZ1: '1L', SLV1: '1.5L', SLV2: '2L', GLD1: '3L', DIA1: '10L' };

const fromName = (schemeName) => {
  const m = String(schemeName || '').match(/(\d+(?:\.\d+)?)\s*lakh/i);
  return m ? parseFloat(m[1]) : null;
};

// "1.5 Lakh Chit" -> "1.5 Lakhs", "1 Lakh Chit" -> "1 Lakh"
export const chitLabel = (schemeName, fallback = '') => {
  const v = fromName(schemeName);
  return v == null ? fallback : `${v} ${v > 1 ? 'Lakhs' : 'Lakh'}`;
};

// "TKT-BRZ1-01" + "1 Lakh Chit" -> "TKT-1L-01"
export const formatTicketId = (id, schemeName) => {
  const raw = String(id || '');
  if (!raw) return raw;
  const slot = (raw.match(/-(\d+)$/) || [])[1];
  if (!slot) return raw;
  const slotStr = slot.padStart(2, '0');

  const v = fromName(schemeName);
  if (v != null) return `TKT-${v}L-${slotStr}`;

  // New backend format: TKT-BRZ-1L-03 -> TKT-1L-03
  const modern = raw.match(/^TKT-[A-Z]+-(\d+(?:\.\d+)?)L-\d+$/i);
  if (modern) return `TKT-${modern[1]}L-${slotStr}`;

  // Legacy seed format: TKT-BRZ1-01 -> TKT-1L-01
  const legacy = raw.match(/^TKT-([A-Z]+\d)-\d+$/i);
  if (legacy && LEGACY_CODES[legacy[1].toUpperCase()]) {
    return `TKT-${LEGACY_CODES[legacy[1].toUpperCase()]}-${slotStr}`;
  }
  return raw;
};

// Tier id -> amount range shown to users instead of Silver / Gold etc.
const TIER_LABELS = {
  starter: '25K – 50K',
  bronze: '50K – 1 Lakh',
  silver: '1 Lakh – 2 Lakh',
  gold: '2 Lakh – 5 Lakh',
  diamond: '5 Lakh – 10 Lakh',
};
export const tierLabel = (tierId) => TIER_LABELS[String(tierId || '').toLowerCase()] || '';

// ---- Chit list helpers -------------------------------------------------------------
// Several chits can share the same amount (e.g. two 1 Lakh chits). They must all be listed,
// each as its own entry:  "1 Lakh Chit", "1 Lakh Chit (1)", "1 Lakh Chit (2)" ...
const schemeValue = (s) => Math.round(Number(s?.totalValue || s?.total_value || 0));
const baseChitTitle = (val) => {
  const lakhs = val / 100000;
  return `${lakhs % 1 === 0 ? lakhs : lakhs.toFixed(1)} Lakh Chit`;
};
// Creation order inside one amount group, read from the saved name: "(2)" -> 2, legacy "Series C" -> 2
const nameSeq = (s) => {
  const n = String(s?.name || '');
  const p = n.match(/\((\d+)\)\s*$/);
  if (p) return parseInt(p[1], 10);
  const l = n.match(/Series\s+([A-Z])\s*$/i);
  if (l) return l[1].toUpperCase().charCodeAt(0) - 65;
  return 0;
};

// De-duplicates by scheme id ONLY (never by amount), sorts by amount, and adds `chitTitle`.
// `rank` (optional) lets a view prefer some schemes first; it never hides any.
export const buildChitList = (rawChits, rank) => {
  const seen = new Set();
  const list = [];
  for (const s of rawChits || []) {
    const id = s.id || s._id;
    if (schemeValue(s) > 0 && !seen.has(id)) { seen.add(id); list.push(s); }
  }
  const groups = {};
  for (const s of list) (groups[schemeValue(s)] ||= []).push(s);
  const titles = new Map();
  for (const [val, arr] of Object.entries(groups)) {
    arr.sort((a, b) => nameSeq(a) - nameSeq(b) || String(a.id || a._id).localeCompare(String(b.id || b._id)));
    arr.forEach((s, i) => titles.set(s.id || s._id, i === 0 ? baseChitTitle(+val) : `${baseChitTitle(+val)} (${i})`));
  }
  const out = list.map((s) => ({ ...s, chitTitle: titles.get(s.id || s._id) }));
  out.sort((a, b) => schemeValue(a) - schemeValue(b) || nameSeq(a) - nameSeq(b) || (rank ? rank(a) - rank(b) : 0));
  return out;
};

export const formatChitName = (s) => {
  if (!s) return 'Chit Scheme';
  if (s.chitTitle) return s.chitTitle;
  const val = schemeValue(s);
  return val >= 100000 ? baseChitTitle(val) : s.name || `₹${val.toLocaleString('en-IN')} Chit`;
};