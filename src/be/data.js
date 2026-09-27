// Lazy loaders for the larger Belgian reference datasets (served as static
// JSON from /data/, built by scripts/build_be_data.py).
const cache = {};
function load(name) {
  return (cache[name] ||= fetch(`/data/${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`Could not load reference data (${r.status}).`);
    return r.json();
  }));
}
export const loadPlaces = () => load('be-places');
export const loadNace = () => load('nace-bel-2025');
export const loadKboCodes = () => load('kbo-codes');

/** Accent- and case-insensitive text for searching. */
export const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
