// Datenquellen: Open-Meteo (Wetter, Luftqualität), Nominatim (Ortssuche), Overpass/OSM (Spots),
// Wikipedia (Beschreibungen), NOAA SWPC (Kp-Index). Alle kostenlos, ohne API-Schlüssel.

const OM_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OM_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
];

const HOURLY = {
  cl: 'cloud_cover_low', cm: 'cloud_cover_mid', ch: 'cloud_cover_high', c: 'cloud_cover',
  vis: 'visibility', ws: 'wind_speed_10m', wg: 'wind_gusts_10m', rh: 'relative_humidity_2m',
  td: 'dew_point_2m', temp: 'temperature_2m', pr: 'precipitation', pp: 'precipitation_probability',
  cape: 'cape', wc: 'weather_code',
};
const AQ_HOURLY = { aod: 'aerosol_optical_depth', dust: 'dust' };

async function getJSON(url, { timeout = 20000, ...opts } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const coordParams = (pts) =>
  `latitude=${pts.map((p) => p.lat.toFixed(4)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(4)).join(',')}`;

function toSeries(loc, map) {
  const h = loc.hourly;
  const s = { t: h.time, offset: loc.utc_offset_seconds ?? 0, elevation: loc.elevation };
  for (const [k, v] of Object.entries(map)) s[k] = h[v] ?? null;
  return s;
}

// Stündliche Wetterdaten für viele Punkte in einer Anfrage
export async function fetchWeather(points, timeout = 30000) {
  const url = `${OM_FORECAST}?${coordParams(points)}&hourly=${Object.values(HOURLY).join(',')}` +
    '&past_hours=6&forecast_hours=36&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh';
  const data = await getJSON(url, { timeout });
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((loc) => toSeries(loc, HOURLY));
}

// Aerosole (AOD) und Saharastaub (CAMS-Modell)
export async function fetchAir(points) {
  const url = `${OM_AQ}?${coordParams(points)}&hourly=${Object.values(AQ_HOURLY).join(',')}` +
    '&past_hours=6&forecast_hours=36&timeformat=unixtime';
  const data = await getJSON(url);
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((loc) => toSeries(loc, AQ_HOURLY));
}

// Geomagnetischer Kp-Index (3-Stunden-Blöcke) → [{t, kp}]
export async function fetchKp() {
  const data = await getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json');
  const rows = Array.isArray(data[0]) ? data.slice(1).map((r) => ({ time_tag: r[0], kp: +r[1] })) : data;
  return rows.map((r) => ({ t: Date.parse(r.time_tag.replace(' ', 'T') + 'Z') / 1000, kp: +r.kp }));
}

const PLACE_KIND = {
  lake: 'See', water: 'Gewässer', reservoir: 'Stausee', peak: 'Gipfel', village: 'Dorf', town: 'Stadt', city: 'Stadt',
  hamlet: 'Weiler', municipality: 'Gemeinde', viewpoint: 'Aussichtspunkt', waterfall: 'Wasserfall', bay: 'Bucht',
  river: 'Fluss', island: 'Insel', mountain_range: 'Gebirge', castle: 'Burg', suburb: 'Ortsteil', locality: 'Ort',
};

export async function searchPlace(q) {
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=de&q=${encodeURIComponent(q)}`;
  try {
    const res = await getJSON(url);
    if (res.length) {
      const seen = new Set();
      return res.map((r) => {
        const kind = PLACE_KIND[r.type] || PLACE_KIND[r.addresstype] || '';
        return {
          lat: +r.lat, lon: +r.lon,
          name: r.name || r.display_name.split(',')[0],
          detail: [kind, r.display_name.split(',').slice(1, 3).join(',').trim()].filter(Boolean).join(' · '),
        };
      }).filter((r) => {
        const k = `${r.name}|${r.detail}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  } catch { /* Fallback unten */ }
  const om = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=de`);
  return (om.results || []).map((r) => ({
    lat: r.latitude, lon: r.longitude, name: r.name,
    detail: [r.admin2 || r.admin1, r.country].filter(Boolean).join(', '),
  }));
}

export async function reverseName(lat, lon) {
  try {
    const r = await getJSON(`${NOMINATIM}/reverse?format=jsonv2&zoom=12&accept-language=de&lat=${lat}&lon=${lon}`, { timeout: 8000 });
    const a = r.address || {};
    return a.village || a.town || a.city || a.municipality || a.county || r.name || null;
  } catch {
    return null;
  }
}

// ---------- Foto-Spots aus OpenStreetMap ----------

// Bounding-Box statt "around" – deutlich schneller auf den Overpass-Servern
function overpassQuery(lat, lon, radiusKm) {
  const dLat = radiusKm / 111.32, dLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((x) => x.toFixed(4)).join(',');
  return `[out:json][timeout:25][bbox:${bb}];(
    nw[tourism=viewpoint][name];
    node[natural=peak][name];
    nw[waterway=waterfall];
    wr[natural=water][water=lake][name];
    wr[natural=water][water=reservoir][name];
    nwr[natural=gorge][name];
    nw[natural=cliff][name];
    nw[natural=arch];
    nwr[natural=glacier][name];
    nw[natural=rock][name][wikidata];
    nwr[natural=beach][name];
    nwr[historic=castle][name];
    nwr[historic=ruins][name][wikidata];
    nw[man_made=lighthouse];
  );out center tags 700;
  nw[tourism=viewpoint][!name];out center tags 120;`;
}

// Die öffentlichen Overpass-Server sind oft überlastet: Server gestaffelt anfragen
// (nächster startet nach 7 s oder sofort bei Fehler), die erste gültige Antwort gewinnt.
export function fetchSpotsOSM(lat, lon, radiusKm) {
  const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon, radiusKm));
  return new Promise((resolve, reject) => {
    let done = false, failed = 0, next = 0, timer = null;
    // Gesamtfrist: lieber ohne OSM weitermachen (Wikidata liefert parallel) als ewig warten
    const deadline = setTimeout(() => { if (!done) { done = true; reject(new Error('Overpass zu langsam')); } }, 20000);
    const start = () => {
      if (done || next >= OVERPASS.length) return;
      const ep = OVERPASS[next++];
      clearTimeout(timer);
      timer = setTimeout(start, 6000);
      getJSON(ep, { method: 'POST', body, timeout: 20000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then((d) => {
          if (!Array.isArray(d?.elements)) throw new Error('ungültige Antwort');
          if (!done) { done = true; clearTimeout(timer); clearTimeout(deadline); resolve(d.elements); }
        })
        .catch(() => {
          if (++failed === OVERPASS.length && !done) {
            done = true; clearTimeout(deadline); reject(new Error('Overpass nicht erreichbar'));
          }
          else start();
        });
    };
    start();
  });
}

// Bekannte Landschaftsziele aus Wikidata: Berge, Seen, Wasserfälle, Schluchten, Burgen …
// Anzahl der Wikipedia-Sprachversionen (sitelinks) dient als Maß für Bekanntheit.
export const WD_TYPES = {
  Q8502: 'peak', Q207326: 'peak', Q54050: 'peak', Q23397: 'lake', Q131681: 'lake', Q34038: 'waterfall',
  Q150784: 'gorge', Q23413: 'castle', Q109607: 'castle', Q6017969: 'viewpoint', Q35666: 'glacier', Q39816: 'lighthouse',
};
export async function fetchSpotsWikidata(lat, lon, radiusKm) {
  const q = `SELECT ?item (SAMPLE(?lbl) AS ?name) (SAMPLE(?coord) AS ?c) (SAMPLE(?type) AS ?t) (SAMPLE(?img) AS ?i)
    (SAMPLE(?ele) AS ?e) (MAX(?links) AS ?n) WHERE {
    SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "${radiusKm}" . }
    VALUES ?type { ${Object.keys(WD_TYPES).map((k) => `wd:${k}`).join(' ')} }
    ?item wdt:P31 ?type ; wikibase:sitelinks ?links .
    OPTIONAL { ?item wdt:P18 ?img . }
    OPTIONAL { ?item wdt:P2044 ?ele . }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en" . ?item rdfs:label ?lbl . }
  } GROUP BY ?item ORDER BY DESC(?n) LIMIT 300`;
  const d = await getJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    timeout: 25000, headers: { Accept: 'application/sparql-results+json' },
  });
  return d.results.bindings.map((b) => {
    const m = b.c.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    return {
      qid: b.item.value.split('/').pop(), name: b.name?.value, type: WD_TYPES[b.t.value.split('/').pop()],
      lon: +m[1], lat: +m[2], img: b.i?.value.replace(/^http:/, 'https:') || null,
      ele: b.e ? +b.e.value : null, links: +b.n.value,
    };
  }).filter((x) => x.type && x.name && !/^Q\d+$/.test(x.name));
}

// Fallback: Wikipedia-Artikel mit Koordinaten (max. 10 km Radius laut API)
export async function fetchSpotsWiki(lat, lon) {
  const url = `https://de.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}` +
    '&gsradius=10000&gslimit=50&format=json&origin=*';
  const d = await getJSON(url);
  return d.query?.geosearch || [];
}

// Kurzbeschreibung + Bild aus Wikipedia (über wikipedia- oder wikidata-Tag)
export async function wikiSummary(tags) {
  let lang = 'de', title = null;
  if (tags.wikipedia) {
    const m = tags.wikipedia.match(/^([a-z-]+):(.+)$/);
    if (m) [, lang, title] = m; else title = tags.wikipedia;
  } else if (tags.wikidata) {
    const d = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${tags.wikidata}` +
      '&props=sitelinks&sitefilter=dewiki|enwiki&format=json&origin=*');
    const sl = d.entities?.[tags.wikidata]?.sitelinks || {};
    if (sl.dewiki) title = sl.dewiki.title;
    else if (sl.enwiki) { lang = 'en'; title = sl.enwiki.title; }
  } else if (tags._wikiTitle) {
    title = tags._wikiTitle;
  }
  if (!title) return null;
  const s = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  return {
    title: s.title, extract: s.extract, thumb: s.thumbnail?.source || null,
    url: s.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}
