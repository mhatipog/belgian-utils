// Belgian Lambert 72 (EPSG:31370) and Lambert 2008 (EPSG:3812) ↔ WGS84.
// Lambert Conic Conformal (2SP) per IOGP Guidance Note 7-2; BD72 → WGS84 with
// the 7-parameter Helmert transformation used by PROJ for EPSG:31370
// (≈1 m accuracy - fine for maps, not for surveying).

const RAD = Math.PI / 180;

const HAYFORD = { a: 6378388, f: 1 / 297 };
const GRS80 = { a: 6378137, f: 1 / 298.257222101 };
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };

function lcc(ell, { lat1, lat2, lat0, lon0, e0, n0 }) {
  const { a } = ell;
  const e = Math.sqrt(ell.f * (2 - ell.f));
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n);
  const r = (p) => a * F * t(p) ** n;
  const rF = lat0 >= 90 ? 0 : r(lat0 * RAD);
  const l0 = lon0 * RAD;
  return {
    forward(lat, lon) {
      const th = n * (lon * RAD - l0);
      const rr = r(lat * RAD);
      return [e0 + rr * Math.sin(th), n0 + rF - rr * Math.cos(th)];
    },
    inverse(x, y) {
      const dx = x - e0;
      const dy = rF - (y - n0);
      const rr = Math.sign(n) * Math.hypot(dx, dy);
      const tt = (rr / (a * F)) ** (1 / n);
      const th = Math.atan2(dx, dy);
      let p = Math.PI / 2 - 2 * Math.atan(tt);
      for (let i = 0; i < 15; i++) {
        const next = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2));
        if (Math.abs(next - p) < 1e-13) { p = next; break; }
        p = next;
      }
      return [p / RAD, (th / n + l0) / RAD];
    },
  };
}

const L72 = lcc(HAYFORD, { lat1: 51.16666723333333, lat2: 49.8333339, lat0: 90, lon0: 4.367486666666666, e0: 150000.013, n0: 5400088.438 });
const L08 = lcc(GRS80, { lat1: 49.83333333333334, lat2: 51.16666666666666, lat0: 50.797815, lon0: 4.359215833333333, e0: 649328, n0: 665262 });

// Geodetic ↔ geocentric.
function toXYZ(lat, lon, ell, h = 0) {
  const e2 = ell.f * (2 - ell.f);
  const p = lat * RAD;
  const l = lon * RAD;
  const N = ell.a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
function fromXYZ([X, Y, Z], ell) {
  const e2 = ell.f * (2 - ell.f);
  const lon = Math.atan2(Y, X);
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const N = ell.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    const h = p / Math.cos(lat) - N;
    lat = Math.atan2(Z, p * (1 - e2 * N / (N + h)));
  }
  return [lat / RAD, lon / RAD];
}

// BD72 → WGS84, position-vector convention (PROJ +towgs84 for EPSG:31370).
const H = { tx: -106.8686, ty: 52.2978, tz: -103.7239, rx: 0.3366, ry: -0.457, rz: 1.8422, s: -1.2747 };
function helmert([x, y, z], inverse = false) {
  const k = inverse ? -1 : 1;
  const sec = (Math.PI / 180 / 3600) * k;
  const rx = H.rx * sec;
  const ry = H.ry * sec;
  const rz = H.rz * sec;
  const s = 1 + H.s * 1e-6 * k;
  if (!inverse) {
    return [H.tx + s * (x - rz * y + ry * z), H.ty + s * (rz * x + y - rx * z), H.tz + s * (-ry * x + rx * y + z)];
  }
  const [a, b, c] = [x - H.tx, y - H.ty, z - H.tz];
  return [s * (a - rz * b + ry * c), s * (rz * a + b - rx * c), s * (-ry * a + rx * b + c)];
}

export function lambert72ToWgs84(x, y) {
  const [lat, lon] = L72.inverse(x, y);
  return fromXYZ(helmert(toXYZ(lat, lon, HAYFORD)), WGS84);
}
export function wgs84ToLambert72(lat, lon) {
  const [bl, bn] = fromXYZ(helmert(toXYZ(lat, lon, WGS84), true), HAYFORD);
  return L72.forward(bl, bn);
}
// ETRS89 is treated as WGS84 (difference well under a metre in Belgium for web use).
export const lambert2008ToWgs84 = (x, y) => L08.inverse(x, y);
export const wgs84ToLambert2008 = (lat, lon) => L08.forward(lat, lon);

/** Rough bounds check for Belgium (with a margin). */
export const inBelgium = (lat, lon) => lat > 49.3 && lat < 51.7 && lon > 2.3 && lon < 6.6;

/** Parse "a b", "a,b", "a;b" (decimal commas allowed when the separator isn't a comma). */
export function parsePair(line) {
  const s = line.trim();
  if (!s) return null;
  let parts;
  if (/[;\t]/.test(s)) parts = s.split(/\s*[;\t]\s*/).map((p) => p.replace(',', '.'));
  else if (s.includes('.') || !/\s/.test(s)) parts = s.split(/\s*,\s*|\s+/); // commas separate
  else parts = s.split(/\s+/).map((p) => p.replace(',', '.')); // decimal commas, space-separated
  if (parts.length < 2) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

/** Convert between 'wgs' (lat, lon), 'l72' and 'l08' (x, y). */
export function convert(from, to, a, b) {
  if (from === to) return [a, b];
  const wgs = from === 'wgs' ? [a, b] : from === 'l72' ? lambert72ToWgs84(a, b) : lambert2008ToWgs84(a, b);
  if (to === 'wgs') return wgs;
  return to === 'l72' ? wgs84ToLambert72(...wgs) : wgs84ToLambert2008(...wgs);
}
