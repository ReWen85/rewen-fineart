// Heuristisches Modell für fotografisch interessante Himmelsphänomene.
// Alle Werte sind Schätzungen (0–100), keine meteorologischen Wahrscheinlichkeiten im strengen Sinn.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// Stückweise lineare Kurve: pts = [[x, y], ...] aufsteigend nach x
export function pl(x, pts) {
  if (x == null || Number.isNaN(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}
const or1 = (v) => (v == null ? 1 : v);

// Wert einer Stundenreihe zum Zeitpunkt t (Unix-Sekunden), linear interpoliert
export function at(s, key, t) {
  const T = s?.t, arr = s?.[key];
  if (!T || !arr || !T.length) return null;
  const n = T.length;
  if (t <= T[0]) return arr[0];
  if (t >= T[n - 1]) return arr[n - 1];
  let i = clamp(Math.floor((t - T[0]) / 3600), 0, n - 2);
  while (i < n - 2 && T[i + 1] <= t) i++;
  while (i > 0 && T[i] > t) i--;
  const a = arr[i], b = arr[i + 1];
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * (t - T[i]) / (T[i + 1] - T[i]);
}

// Summe einer Reihe über die `hours` Stunden vor t
export function sumBefore(s, key, t, hours) {
  let sum = 0;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] > t - hours * 3600 && s.t[i] <= t) sum += s[key][i] || 0;
  }
  return sum;
}

// ---------- Bausteine für Abend-/Morgenrot ----------

// Lokale Faktoren: Wolken-"Leinwand", tiefe Wolken, Regen, Sicht, Feuchte
export function localFactors(s, t) {
  const L = at(s, 'cl', t) ?? 0, M = at(s, 'cm', t) ?? 0, H = at(s, 'ch', t) ?? 0;
  const canvas = Math.max(H, M * 0.8);
  return {
    L, M, H, canvas,
    fCanvas: pl(canvas, [[0, 0.04], [10, 0.25], [25, 0.8], [40, 1], [70, 1], [85, 0.75], [100, 0.45]]),
    fThick: pl(M, [[0, 1], [70, 1], [90, 0.7], [100, 0.5]]),
    fLow: pl(L, [[0, 1], [20, 0.95], [40, 0.75], [60, 0.5], [80, 0.25], [100, 0.08]]),
    fRain: or1(pl(at(s, 'pr', t), [[0, 1], [0.2, 0.8], [0.5, 0.5], [1.5, 0.2], [4, 0.05]])),
    fVis: or1(pl(at(s, 'vis', t), [[0, 0.2], [1000, 0.3], [5000, 0.7], [10000, 0.95], [20000, 1]])),
    fRh: or1(pl(at(s, 'rh', t), [[0, 1], [80, 1], [95, 0.85], [100, 0.75]])),
  };
}

// Lichtweg Richtung Sonne: tiefe/mittlere Wolken 40–200 km sonnenwärts blockieren das Licht
const RING_W = { 40: 0.25, 80: 0.3, 130: 0.25, 200: 0.2 };
export function gapFactor(ring, t) {
  if (!ring?.length) return { block: 0.3, fGap: 0.7, near: 30 };
  let block = 0, wsum = 0;
  for (const r of ring) {
    const w = RING_W[r.d] ?? 0.25;
    const b = Math.min(1, ((at(r.s, 'cl', t) ?? 0) + 0.5 * (at(r.s, 'cm', t) ?? 0)) / 100);
    block += w * b; wsum += w;
  }
  block /= wsum;
  const nearPts = ring.filter((r) => r.d <= 80);
  const near = nearPts.reduce((a, r) => a + (at(r.s, 'cl', t) ?? 0), 0) / Math.max(1, nearPts.length);
  return {
    block, near,
    fGap: pl(block, [[0, 1], [0.2, 0.92], [0.4, 0.7], [0.6, 0.45], [0.8, 0.2], [1, 0.05]]),
  };
}

export const aerosolFactor = (aod) =>
  or1(pl(aod, [[0, 0.85], [0.08, 0.95], [0.15, 1], [0.35, 1], [0.6, 0.85], [1.0, 0.6], [2, 0.4]]));

// Farbenspiel-Score für eine Gitterzelle (Karten-Overlay)
export function colorScoreCell(s, t, gap, aod) {
  const f = localFactors(s, t);
  return 100 * f.fCanvas * f.fThick * f.fLow * f.fRain * f.fVis * f.fRh * gap.fGap * aerosolFactor(aod);
}

// ---------- Sonnenauf-/untergang komplett bewerten ----------

export function scoreSunEvent({ t, center, ring, aq, compass }) {
  const f = localFactors(center, t);
  const gap = gapFactor(ring, t);
  const aod = aq ? at(aq, 'aod', t) : null;
  const dust = aq ? at(aq, 'dust', t) : null;
  const pr = at(center, 'pr', t) ?? 0;
  const C = at(center, 'c', t) ?? Math.max(f.L, f.M, f.H);
  const cape = at(center, 'cape', t) ?? 0;
  const ws = at(center, 'ws', t);
  const prevRain = sumBefore(center, 'pr', t - 3600, 4);
  const fAer = aerosolFactor(aod);

  let red = f.fCanvas * f.fThick * f.fLow * f.fRain * f.fVis * f.fRh * gap.fGap * fAer;
  const clearing = prevRain > 0.3 && pr < 0.1;
  if (clearing) red *= 1.12;
  red = clamp(red) * 100;

  const sunVis = clamp(1 - Math.min(1, (0.4 * f.L + 0.6 * gap.near) / 100 + 0.25 * f.M / 100)) * f.fVis * f.fRain * 100;

  const dustF = or1(pl(dust, [[0, 0], [15, 0.05], [40, 0.35], [80, 0.7], [150, 0.9]])) * (dust == null ? 0 : 1);
  const stormF = pl(C, [[0, 0], [70, 0], [80, 0.4], [95, 1]]) * gap.fGap * pl(cape, [[0, 0.25], [300, 0.5], [1000, 1]]);
  const yellow = clamp(Math.max(dustF, stormF * 0.8)) * 100;

  const calm = ws == null ? null : pl(ws, [[0, 1], [4, 0.9], [8, 0.5], [12, 0.15], [18, 0]]) * 100;

  // Klare Sonne ohne Wolkenfarben ist nett, aber nicht spektakulär → max. ca. 35
  const overall = Math.max(red, yellow * 0.9, 0.35 * sunVis + 0.3 * red);

  // Begründungen in Klartext
  const why = [];
  const pct = (x) => `${Math.round(x)} %`;
  if (f.canvas >= 25 && f.canvas <= 75) why.push([true, `Hohe/mittlere Wolken ${pct(f.canvas)} – gute „Leinwand“ für Farbe`]);
  else if (f.canvas < 25) why.push([false, `Kaum hohe/mittlere Wolken (${pct(f.canvas)}) – Himmel bleibt eher einfarbig`]);
  else why.push([false, `Sehr dichte mittlere/hohe Bewölkung (${pct(f.canvas)}) – Licht kommt schwer durch`]);
  if (f.L >= 50) why.push([false, `Tiefe Wolken vor Ort ${pct(f.L)} verdecken den Himmel`]);
  else if (f.L <= 20) why.push([true, `Kaum tiefe Wolken vor Ort (${pct(f.L)})`]);
  if (gap.block <= 0.3) why.push([true, `Horizont Richtung ${compass} (40–200 km) weitgehend frei – Licht erreicht die Wolken`]);
  else if (gap.block >= 0.55) why.push([false, `Wolken Richtung ${compass} blockieren das Sonnenlicht`]);
  if (clearing) why.push([true, 'Abziehender Regen – klare, dramatische Luft']);
  if (pr >= 0.3) why.push([false, `Niederschlag zur Zeit (${pr.toFixed(1)} mm/h)`]);
  if (aod != null && aod >= 0.6) why.push([false, `Viel Dunst/Aerosole (AOD ${aod.toFixed(2)}) – Farben gedämpft`]);
  else if (aod != null && aod >= 0.15) why.push([true, `Leichter Dunst (AOD ${aod.toFixed(2)}) verstärkt Rottöne`]);
  if (dust != null && dust >= 40) why.push([true, `Saharastaub ${Math.round(dust)} µg/m³ – gelb-oranger Himmel möglich`]);
  if (calm != null && calm >= 70) why.push([true, `Fast windstill (${Math.round(ws)} km/h) – Spiegelungen auf Seen`]);

  return {
    overall: Math.round(overall), red: Math.round(red), yellow: Math.round(yellow), sunVis: Math.round(sunVis),
    calm: calm == null ? null : Math.round(calm), why,
    raw: { ...f, gap, aod, dust, pr, C, cape, ws },
  };
}

export function verdict(score) {
  if (score >= 70) return 'Spektakulär möglich';
  if (score >= 50) return 'Gute Chancen';
  if (score >= 30) return 'Mäßig';
  return 'Eher unspektakulär';
}

// ---------- Weitere Phänomene, stündlich ----------

export function fogProb(s, t) {
  const T = at(s, 'temp', t), Td = at(s, 'td', t), ws = at(s, 'ws', t) ?? 5, rh = at(s, 'rh', t) ?? 0;
  const vis = at(s, 'vis', t), wc = Math.round(at(s, 'wc', t) ?? 0);
  const spread = T != null && Td != null ? T - Td : 5;
  let p = pl(spread, [[0, 1], [1, 0.85], [2, 0.4], [3, 0.1], [4, 0]]) *
    pl(ws, [[0, 1], [5, 0.9], [10, 0.5], [15, 0.15], [20, 0]]) *
    pl(rh, [[85, 0], [92, 0.5], [97, 1]]);
  if (vis != null && vis < 1000) p = Math.max(p, 0.9);
  if (wc === 45 || wc === 48) p = Math.max(p, 0.95);
  return clamp(p) * 100;
}

export function farViewProb(s, t, aod, sunAlt) {
  if (sunAlt < 0) return 0;
  const vis = at(s, 'vis', t), rh = at(s, 'rh', t) ?? 80, L = at(s, 'cl', t) ?? 0;
  const fVis = or1(pl(vis, [[10000, 0], [20000, 0.4], [30000, 0.7], [50000, 1]]));
  const fDry = pl(rh, [[35, 1], [55, 0.75], [75, 0.25], [90, 0]]);
  const fAir = or1(pl(aod, [[0.05, 1], [0.12, 0.8], [0.25, 0.35], [0.45, 0]]));
  return clamp((0.5 * fVis + 0.5 * fDry) * fAir * (1 - 0.8 * L / 100)) * 100;
}

// rainAnti: max. Niederschlag (mm/h) in Gitterzellen auf der sonnenabgewandten Seite
export function rainbowProb(s, t, sunAltDeg, rainAnti) {
  if (sunAltDeg < 1 || sunAltDeg > 42) return 0;
  const L = at(s, 'cl', t) ?? 0, M = at(s, 'cm', t) ?? 0;
  const fAlt = pl(sunAltDeg, [[1, 0.6], [5, 1], [30, 0.9], [42, 0]]);
  const fSun = clamp(1 - Math.max(L, 0.8 * M) / 100 * 1.1);
  const fRain = pl(rainAnti, [[0, 0], [0.1, 0.3], [0.5, 0.8], [2, 1]]);
  return clamp(fAlt * fSun * fRain * 0.9) * 100;
}

export function stormProb(s, t) {
  const cape = at(s, 'cape', t) ?? 0, pp = at(s, 'pp', t) ?? 0, wc = Math.round(at(s, 'wc', t) ?? 0);
  let p = pl(cape, [[0, 0], [300, 0.15], [800, 0.45], [1500, 0.75], [2500, 0.95]]) * pl(pp, [[0, 0.3], [40, 0.8], [70, 1]]);
  if (wc >= 95) p = Math.max(p, 0.9);
  return clamp(p) * 100;
}

export function starsProb(s, t, sunAltDeg, moonAltDeg, moonFrac) {
  if (sunAltDeg > -10) return 0;
  const C = at(s, 'c', t) ?? 100, rh = at(s, 'rh', t) ?? 80;
  const fDark = pl(sunAltDeg, [[-18, 1], [-14, 0.7], [-10, 0.3]]);
  const fCloud = pl(C, [[0, 1], [10, 0.9], [25, 0.5], [50, 0.1], [70, 0]]);
  const fMoon = moonAltDeg > 0 ? 1 - 0.75 * moonFrac : 1;
  const fHum = pl(rh, [[0, 1], [85, 1], [97, 0.75]]);
  return clamp(fDark * fCloud * fMoon * fHum) * 100;
}

// Benötigter Kp-Index für sichtbares Polarlicht (Kamera) je nach Breite
export function auroraProb(kp, lat, sunAltDeg, cloud) {
  if (kp == null || sunAltDeg > -10) return 0;
  // z. B. 55° N → Kp ≈ 5, 48° N → Kp ≈ 7,5
  const need = 4 + (60 - Math.abs(lat)) * 0.33 - 0.5;
  const x = kp - need;
  const base = x >= 0 ? 0.5 + 0.2 * x : x > -1 ? 0.5 * (1 + x) : 0;
  return clamp(base * pl(cloud ?? 100, [[0, 1], [30, 0.6], [60, 0.15], [80, 0]])) * 100;
}

export function dustSkyProb(dust) {
  return clamp(or1(pl(dust, [[0, 0], [15, 0.05], [40, 0.35], [80, 0.7], [150, 0.9]])) * (dust == null ? 0 : 1)) * 100;
}
