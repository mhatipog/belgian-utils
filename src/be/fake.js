// Deterministic fake data for anonymising files: the same real value always
// maps to the same fake value within one run, so references stay consistent
// across a file. Generated identifiers are checksum-valid.

import { enterpriseWithCheck, ogmCheck } from './ids.js';

const FIRST = ['Ann', 'Bart', 'Chloé', 'Dirk', 'Els', 'Fien', 'Geert', 'Hilde', 'Ilse', 'Jan', 'Karel', 'Lotte', 'Marc', 'Nina', 'Olivier', 'Petra', 'Rik', 'Sofie', 'Tom', 'Veerle', 'Wim', 'Yasmine', 'Zoë', 'Luc', 'Marie'];
const LAST = ['Peeters', 'Janssens', 'Maes', 'Jacobs', 'Mertens', 'Willems', 'Claes', 'Goossens', 'Wouters', 'De Smet', 'Dubois', 'Lambert', 'Dupont', 'Martin', 'Leroy', 'Vermeulen', 'Hermans', 'Aerts', 'Pauwels', 'Van den Broeck'];
const COMPANY = ['Voorbeeld', 'Testbedrijf', 'Demo', 'Proef', 'Exemple', 'Modèle', 'Sample', 'Fictief', 'Oefen', 'Placebo'];
const SUFFIX = ['BV', 'NV', 'SRL', 'SA', 'CV', 'VZW'];
const STREETS = ['Kerkstraat', 'Stationsstraat', 'Rue de la Gare', 'Dorpstraat', 'Nieuwstraat', 'Rue de l’Église', 'Molenstraat', 'Schoolstraat'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1e9) / 1e9; };
}

export function makeFaker(salt = String(Math.random())) {
  const memo = new Map();
  const once = (kind, value, gen) => {
    const k = `${kind}\u0000${value}`;
    if (!memo.has(k)) memo.set(k, gen(rng(hash(salt + k))));
    return memo.get(k);
  };
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const digits = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  return {
    name: (v) => once('name', v, (r) => (/\b(BV|NV|SRL|SA|CV|VZW|BVBA|SPRL|LTD|GMBH|INC)\b/i.test(v) || r() < 0.3
      ? `${pick(r, COMPANY)} ${pick(r, LAST)} ${pick(r, SUFFIX)}` : `${pick(r, FIRST)} ${pick(r, LAST)}`)),
    person: (v) => once('person', v, (r) => `${pick(r, FIRST)} ${pick(r, LAST)}`),
    street: (v) => once('street', v, (r) => `${pick(r, STREETS)} ${1 + Math.floor(r() * 150)}`),
    email: (v) => once('email', v, (r) => `${pick(r, FIRST).toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')}.${digits(r, 3)}@example.com`),
    phone: (v) => once('phone', v, (r) => `+32 4${digits(r, 2)} ${digits(r, 2)} ${digits(r, 2)} ${digits(r, 2)}`),
    enterprise: (v) => once('ent', v, (r) => enterpriseWithCheck(`0${1 + Math.floor(r() * 8)}${digits(r, 6)}`)),
    iban: (v) => once('iban', v, (r) => {
      if (!/^BE/i.test(v)) return v.replace(/\d/g, () => digits(r, 1)).slice(0, v.length);
      const bank = v.replace(/\s/g, '').slice(4, 7) || '001';
      const ten = bank + digits(r, 7);
      const c = Number(BigInt(ten) % 97n) || 97;
      const bban = ten + String(c).padStart(2, '0');
      const check = 98 - Number(BigInt(`${bban}111400`) % 97n);
      return `BE${String(check).padStart(2, '0')}${bban}`;
    }),
    ogmDigits: (v) => once('ogm', v, (r) => { const ten = digits(r, 10); return ten + ogmCheck(ten); }),
    ref: (v) => once('ref', v, (r) => v.replace(/[A-Za-z]/g, () => String.fromCharCode(65 + Math.floor(r() * 26))).replace(/\d/g, () => digits(r, 1))),
    text: (v) => once('text', v, (r) => v.replace(/[A-Za-zÀ-ÿ]/g, (c) => (c === c.toUpperCase() ? 'X' : 'x')).replace(/\d/g, () => digits(r, 1))),
  };
}
