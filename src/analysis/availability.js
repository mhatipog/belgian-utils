const MIN = 60000;

function validSlot(slot, person) {
  const start = Number(slot.start), end = Number(slot.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Invalid availability interval${person ? ` for ${person}` : ''}.`);
  return { start, end };
}

function mergeSlots(slots) {
  const s = slots.slice().sort((a, b) => a.start - b.start || a.end - b.end), out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end); else out.push({ ...x });
  }
  return out;
}

export function normalizeAvailability(participants) {
  if (!Array.isArray(participants) || !participants.length) throw new Error('Add at least one participant.');
  const seen = new Set();
  return participants.map((p, i) => {
    const name = String(p.name ?? '').trim() || `Person ${i + 1}`;
    if (seen.has(name)) throw new Error(`Participant names must be unique (${name}).`);
    seen.add(name);
    return { name, slots: mergeSlots((p.slots || []).map((s) => validSlot(s, name))) };
  });
}

function covers(slots, start, end) { return slots.some((s) => s.start <= start && s.end >= end); }

export function commonAvailability(participants, { minParticipants = participants.length } = {}) {
  const ps = normalizeAvailability(participants);
  if (!Number.isInteger(minParticipants) || minParticipants < 1 || minParticipants > ps.length) throw new RangeError('minParticipants is out of range.');
  const events = [];
  ps.forEach((p, i) => p.slots.forEach((s) => { events.push([s.start, 1, i], [s.end, -1, i]); }));
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const active = new Set(), out = [];
  let i = 0, prev = null;
  while (i < events.length) {
    const t = events[i][0];
    if (prev !== null && t > prev && active.size >= minParticipants) {
      const names = [...active].map((x) => ps[x].name).sort();
      const last = out[out.length - 1];
      if (last && last.end === prev && last.names.join('\0') === names.join('\0')) last.end = t;
      else out.push({ start: prev, end: t, count: names.length, names });
    }
    while (i < events.length && events[i][0] === t) {
      const [, type, who] = events[i++];
      if (type < 0) active.delete(who); else active.add(who);
    }
    prev = t;
  }
  return out;
}

export function bestMeetingWindows(participants, { durationMinutes = 30, minParticipants = 1, limit = 20 } = {}) {
  const ps = normalizeAvailability(participants);
  if (!(durationMinutes > 0)) throw new RangeError('durationMinutes must be positive.');
  if (!Number.isInteger(minParticipants) || minParticipants < 1 || minParticipants > ps.length) throw new RangeError('minParticipants is out of range.');
  const dur = durationMinutes * MIN, starts = new Set();
  for (const p of ps) for (const s of p.slots) {
    if (s.end - s.start >= dur) { starts.add(s.start); starts.add(s.end - dur); }
  }
  const candidates = [];
  for (const start of starts) {
    const end = start + dur;
    const names = ps.filter((p) => covers(p.slots, start, end)).map((p) => p.name);
    if (names.length >= minParticipants) candidates.push({ start, end, count: names.length, names });
  }
  candidates.sort((a, b) => b.count - a.count || a.start - b.start || a.end - b.end);
  const out = [];
  for (const c of candidates) {
    if (out.some((x) => x.start === c.start && x.end === c.end && x.names.join('\0') === c.names.join('\0'))) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseAvailabilityText(text, { zoneOffsetMinutes = null } = {}) {
  const participants = [];
  const map = new Map();
  const parseDt = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(s.trim());
    if (!m) throw new Error(`Invalid date/time: ${s}. Use YYYY-MM-DD HH:MM.`);
    const [,Y,M,D,h,min] = m.map(Number);
    if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || min > 59) throw new Error(`Invalid date/time: ${s}`);
    if (zoneOffsetMinutes === null) {
      const d = new Date(Y, M-1, D, h, min, 0, 0);
      if (d.getFullYear() !== Y || d.getMonth() !== M-1 || d.getDate() !== D || d.getHours() !== h || d.getMinutes() !== min) throw new Error(`Invalid date/time: ${s}`);
      return d.getTime();
    }
    const t = Date.UTC(Y, M-1, D, h, min) - zoneOffsetMinutes * MIN;
    const chk = new Date(t + zoneOffsetMinutes * MIN);
    if (chk.getUTCFullYear() !== Y || chk.getUTCMonth() !== M-1 || chk.getUTCDate() !== D || chk.getUTCHours() !== h || chk.getUTCMinutes() !== min) throw new Error(`Invalid date/time: ${s}`);
    return t;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const [nameRaw, rangesRaw] = line.split(/\s*\|\s*/, 2);
    if (!rangesRaw) throw new Error(`Expected “Name | start - end”: ${line}`);
    const name = nameRaw.trim();
    if (!name) throw new Error(`Participant name is required: ${line}`);
    if (!map.has(name)) { const p = { name, slots: [] }; map.set(name, p); participants.push(p); }
    for (const range of rangesRaw.split(/\s*;\s*/)) {
      const m = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*(?:-|→|to)\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})$/.exec(range.trim());
      if (!m) throw new Error(`Invalid interval: ${range}`);
      map.get(name).slots.push({ start: parseDt(m[1]), end: parseDt(m[2]) });
    }
  }
  return normalizeAvailability(participants);
}
