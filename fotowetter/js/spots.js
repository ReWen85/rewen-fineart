// Foto-Spots aus OSM klassifizieren und für die aktuelle Wetterlage bewerten.
import { bearing, distanceKm, compass } from './geo.js';

export const SPOT_TYPES = {
  viewpoint: { icon: '🔭', label: 'Aussichtspunkt', base: 30 },
  peak: { icon: '⛰️', label: 'Gipfel', base: 25 },
  waterfall: { icon: '💧', label: 'Wasserfall', base: 35 },
  lake: { icon: '🏞️', label: 'See', base: 30 },
  gorge: { icon: '🪨', label: 'Schlucht/Klamm', base: 32 },
  rock: { icon: '🪨', label: 'Fels', base: 20 },
  glacier: { icon: '🧊', label: 'Gletscher', base: 35 },
  castle: { icon: '🏰', label: 'Burg/Ruine', base: 25 },
  lighthouse: { icon: '🗼', label: 'Leuchtturm', base: 30 },
  beach: { icon: '🏖️', label: 'Strand', base: 20 },
  wiki: { icon: '📖', label: 'Sehenswürdigkeit', base: 15 },
};

function spotType(tg) {
  if (tg.waterway === 'waterfall') return 'waterfall';
  if (tg.tourism === 'viewpoint') return 'viewpoint';
  if (tg.natural === 'peak' || tg.natural === 'volcano') return 'peak';
  if (tg.natural === 'water') return 'lake';
  if (tg.natural === 'glacier') return 'glacier';
  if (tg.natural === 'gorge') return 'gorge';
  if (['cliff', 'rock', 'arch'].includes(tg.natural)) return 'rock';
  if (tg.historic === 'castle' || tg.historic === 'ruins') return 'castle';
  if (tg.man_made === 'lighthouse') return 'lighthouse';
  if (tg.natural === 'beach') return 'beach';
  return null;
}

// Richtungs-Tag (z. B. "W", "270", "200-300") → Liste von Gradzahlen
const DIRS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
function parseDirection(v) {
  if (!v) return null;
  const range = v.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const a = +range[1], b = +range[2];
    const span = (b - a + 360) % 360;
    return { center: (a + span / 2) % 360, half: Math.max(30, span / 2) };
  }
  const deg = DIRS[v.toUpperCase()] ?? (Number.isFinite(+v) ? +v : null);
  return deg == null ? null : { center: deg, half: 45 };
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function parseOSM(elements, center) {
  const seen = new Map();
  const out = [];
  for (const e of elements) {
    const tg = e.tags || {};
    const type = spotType(tg);
    if (!type) continue;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    const name = tg['name:de'] || tg.name || null;
    const key = `${type}|${name || e.id}`;
    const prev = seen.get(key);
    if (prev && distanceKm(prev, { lat, lon }) < 1.5) continue;
    const spot = {
      id: `${e.type}/${e.id}`, osm: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      type, name, lat, lon, tags: tg,
      ele: tg.ele ? parseFloat(tg.ele) : null,
      dir: parseDirection(tg.direction),
      wiki: !!(tg.wikipedia || tg.wikidata),
      dist: distanceKm(center, { lat, lon }),
      brg: bearing(center, { lat, lon }),
    };
    seen.set(key, spot);
    out.push(spot);
  }
  return out;
}

export function parseWikidata(list, center) {
  return list.map((w) => ({
    id: `wd/${w.qid}`, wdUrl: `https://www.wikidata.org/wiki/${w.qid}`,
    type: w.type, name: w.name, lat: w.lat, lon: w.lon, tags: { wikidata: w.qid },
    ele: w.ele, dir: null, wiki: true, img: w.img, links: w.links,
    dist: distanceKm(center, w), brg: bearing(center, w),
  }));
}

// OSM- und Wikidata-Treffer zusammenführen (gleiche Wikidata-ID oder gleicher Name in < 2 km)
export function mergeSpots(osm, wd) {
  const byQid = new Map(osm.filter((s) => s.tags.wikidata).map((s) => [s.tags.wikidata, s]));
  const out = [...osm];
  for (const w of wd) {
    const twin = byQid.get(w.tags.wikidata) ||
      osm.find((s) => s.name && w.name && s.name.toLowerCase() === w.name.toLowerCase() && distanceKm(s, w) < 2);
    if (twin) {
      twin.img ??= w.img;
      twin.links = w.links;
      twin.ele ??= w.ele;
      twin.wiki = true;
      twin.tags.wikidata ??= w.tags.wikidata;
    } else {
      out.push(w);
    }
  }
  return out;
}

// Für den Zwischenspeicher nur das Nötigste behalten
export function slimSpot(s) {
  const keep = ['wikipedia', 'wikidata', 'image', 'wikimedia_commons', '_wikiTitle'];
  const tags = Object.fromEntries(keep.filter((k) => s.tags[k]).map((k) => [k, s.tags[k]]));
  const { marker, wikiData, score, fit, dirText, ...rest } = s;
  return { ...rest, tags };
}

export function parseWiki(list, center) {
  return list.map((w) => ({
    id: `wiki/${w.pageid}`, type: 'wiki', name: w.title, lat: w.lat, lon: w.lon,
    tags: { _wikiTitle: w.title }, ele: null, dir: null, wiki: true,
    dist: distanceKm(center, w), brg: bearing(center, w),
  }));
}

// cond: Zusammenfassung der Wetterlage aus app.js
export function rateSpots(spots, cond) {
  for (const s of spots) {
    const T = SPOT_TYPES[s.type];
    // Bekanntheit/Qualität des Ortes (max. ca. 70)
    let score = T.base;
    if (s.name) score += 5; else score -= 8;
    if (s.wiki) score += 8;
    if (s.links) score += Math.min(12, s.links * 0.6);
    if (s.img || s.tags.image || s.tags.wikimedia_commons) score += 3;
    if (s.type === 'peak' && s.ele) score += Math.min(10, Math.max(0, (s.ele - (cond.elevation ?? 0)) / 100));
    if (s.type === 'viewpoint' && s.ele && cond.elevation != null && s.ele - cond.elevation > 150) score += 5;
    score -= Math.min(8, (s.dist / Math.max(5, cond.radius ?? 25)) * 8);

    const fit = [];
    let bonus = 0;
    const high = s.ele != null && cond.elevation != null && s.ele - cond.elevation > 250;
    const outlook = ['viewpoint', 'peak'].includes(s.type);
    const water = s.type === 'lake' || s.type === 'beach';
    if (cond.color >= 45 && (outlook || water)) {
      bonus += 12; fit.push(`Farbiger Himmel erwartet (${cond.colorLabel})`);
    }
    if (cond.calm && water) { bonus += 12; fit.push('Windstill – Spiegelungen'); }
    if (cond.fog >= 45 && (high || (outlook && s.ele))) { bonus += 18; fit.push('Chance, über dem Nebel zu stehen'); }
    else if (cond.fog >= 45 && water) { bonus += 8; fit.push('Nebelschwaden über dem Wasser'); }
    if (cond.overcast && ['waterfall', 'gorge'].includes(s.type)) { bonus += 15; fit.push('Weiches Licht bei Bewölkung'); }
    if (cond.recentRain && s.type === 'waterfall') { bonus += 8; fit.push('Viel Wasser nach Regen'); }
    if (cond.farView >= 50 && outlook) { bonus += 12; fit.push('Gute Fernsicht'); }
    if (cond.stars >= 50 && (outlook || water)) { bonus += 8; fit.push('Klarer Nachthimmel'); }
    if (s.dir && cond.events) {
      for (const ev of cond.events) {
        if (angDiff(s.dir.center, ev.az) <= s.dir.half) {
          bonus += 10; fit.push(`Blick Richtung ${ev.kind === 'set' ? 'Sonnenuntergang' : 'Sonnenaufgang'}`);
          break;
        }
      }
    }
    // Passung zur heutigen Wetterlage (max. +30)
    const fitBonus = Math.min(30, bonus);
    s.score = Math.round(Math.max(0, Math.min(100, score + fitBonus)));
    s.fit = fit;
    s.dirText = `${s.dist.toFixed(1)} km ${compass(s.brg)}`;
  }
  spots.sort((a, b) => b.score - a.score || a.dist - b.dist);
  // Für Abwechslung sorgen: jeder weitere Spot gleichen Typs rutscht in der Reihenfolge etwas nach hinten
  const seen = {}, ranked = [];
  const pool = spots.slice();
  while (pool.length) {
    let best = 0, bestVal = -Infinity;
    for (let k = 0; k < Math.min(pool.length, 40); k++) {
      const v = pool[k].score - 2.5 * (seen[pool[k].type] || 0);
      if (v > bestVal) { bestVal = v; best = k; }
    }
    const [s] = pool.splice(best, 1);
    seen[s.type] = (seen[s.type] || 0) + 1;
    ranked.push(s);
  }
  return ranked;
}
