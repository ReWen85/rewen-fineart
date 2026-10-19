import * as api from './api.js';
import * as S from './score.js';
import { parseOSM, parseWiki, parseWikidata, mergeSpots, slimSpot, rateSpots, SPOT_TYPES } from './spots.js';
import { destination, bearing, compass, sunBearing, distanceKm } from './geo.js';

const N = 7;                       // Wettergitter N×N um den Ort
const RING_D = [40, 80, 130, 200]; // Stützpunkte Richtung Sonne (km)
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const deg = (r) => r * 180 / Math.PI;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } },
};

const state = { run: 0, loc: null, radius: store.get('radius') || 25, layer: 'color', t: 0, d: null, spots: null };

// ---------- Karte ----------
const map = L.map('map', { zoomControl: false, zoomSnap: 0.25 }).setView([48.5, 10.5], 6);
L.control.zoom({ position: 'topright' }).addTo(map);
const baseLayers = {
  Karte: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  Topografie: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  }),
};
const savedBase = store.get('base');
(baseLayers[savedBase] || baseLayers.Karte).addTo(map);
L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e) => store.set('base', e.name));
map.attributionControl.addAttribution('Wetter: <a href="https://open-meteo.com">Open-Meteo</a>');

const sunLayer = L.layerGroup().addTo(map);
const spotLayer = L.layerGroup().addTo(map);
let overlay = null, centerMarker = null, gridBounds = null;

map.on('click', (e) => {
  const box = document.createElement('div');
  box.className = 'pick';
  const btn = document.createElement('button');
  btn.className = 'btn btn-accent';
  btn.textContent = 'Hier analysieren';
  btn.onclick = () => { map.closePopup(); analyze({ lat: e.latlng.lat, lon: e.latlng.lng, name: null }); };
  box.append(btn);
  L.popup().setLatLng(e.latlng).setContent(box).openOn(map);
});

// ---------- Zeit ----------
const fmtTime = (t) => new Date((t + (state.d?.offset ?? 0)) * 1000).toISOString().slice(11, 16);
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function fmtDay(t) {
  const off = state.d?.offset ?? 0;
  const day = (x) => Math.floor((x + off) / 86400);
  const diff = day(t) - day(Date.now() / 1000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  return WD[new Date((t + off) * 1000).getUTCDay()];
}

function sunEvents(lat, lon, from, to) {
  const out = [];
  for (let k = -1; k <= 2; k++) {
    const day = new Date((from + k * 86400) * 1000);
    const tm = SunCalc.getTimes(day, lat, lon);
    for (const [kind, key] of [['rise', 'sunrise'], ['set', 'sunset']]) {
      const dt = tm[key];
      if (!dt || Number.isNaN(dt.getTime())) continue;
      const t = dt.getTime() / 1000;
      if (t < from || t > to || out.some((e) => Math.abs(e.t - t) < 3600)) continue;
      const az = sunBearing(SunCalc.getPosition(dt, lat, lon).azimuth);
      const ts = (d) => (d && !Number.isNaN(d.getTime()) ? d.getTime() / 1000 : null);
      out.push({
        kind, t, az,
        golden: kind === 'rise' ? [t, ts(tm.goldenHourEnd)] : [ts(tm.goldenHour), t],
        blue: kind === 'rise' ? [ts(tm.dawn), t] : [t, ts(tm.dusk)],
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------- Ablauf ----------
async function analyze(loc) {
  const run = ++state.run;
  state.loc = loc;
  state.spots = null;
  spotLayer.clearLayers();
  if (overlay) { overlay.remove(); overlay = null; }
  $('#tab-spots').innerHTML = '<p class="muted">Foto-Spots werden recherchiert (OpenStreetMap + Wikidata) …</p>';
  store.set('loc', loc);
  setBusy('Wetterdaten werden geladen …');

  const { lat, lon } = loc;
  const R = state.radius;
  const now = Date.now() / 1000;
  const dLat = R / 111.32, dLon = R / (111.32 * Math.cos(lat * Math.PI / 180));
  const grid = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      grid.push({ i, j, lat: lat + dLat * (1 - 2 * i / (N - 1)), lon: lon - dLon + 2 * dLon * j / (N - 1) });
    }
  }
  gridBounds = L.latLngBounds([lat - dLat, lon - dLon], [lat + dLat, lon + dLon]);
  const events = sunEvents(lat, lon, now - 1800, now + 86400);
  const ring = [];
  events.forEach((ev, k) => RING_D.forEach((d) => ring.push({ ev: k, d, ...destination(loc, ev.az, d) })));

  if (centerMarker) centerMarker.remove();
  centerMarker = L.marker([lat, lon], { icon: L.divIcon({ className: 'center-pin', html: '<span></span>', iconSize: [22, 22] }) }).addTo(map);
  map.invalidateSize();
  map.fitBounds(gridBounds, { padding: [10, 10] });

  if (!loc.name) api.reverseName(lat, lon).then((n) => { if (n && run === state.run) { loc.name = n; store.set('loc', loc); renderHead(); } });
  const spotsP = loadSpots(loc, Math.min(R, 40));

  // Erst Ort + Sonnenrichtung laden (schnell), das Kartengitter parallel in kleinen Paketen
  const centerPt = grid[(N * N - 1) / 2];
  const others = grid.filter((g) => g !== centerPt);
  const chunk = Math.ceil(others.length / 4);
  const gridP = Promise.all([0, 1, 2, 3].map((k) => api.fetchWeather(others.slice(k * chunk, (k + 1) * chunk), 60000)));
  gridP.catch(() => {});

  const [wx, aq, kp] = await Promise.allSettled([api.fetchWeather([centerPt, ...ring], 45000), api.fetchAir([loc]), api.fetchKp()]);
  if (run !== state.run) return;
  if (wx.status !== 'fulfilled') {
    setBusy(null);
    toast('Wetterdaten konnten nicht geladen werden. Bitte später erneut versuchen.');
    return;
  }
  const series = wx.value;
  centerPt.s = series[0];
  ring.forEach((r, k) => { r.s = series[1 + k]; });
  const center = centerPt.s;
  const aqC = aq.status === 'fulfilled' ? aq.value[0] : null;

  const d = {
    loc, grid, center, aq: aqC, events, now, gridReady: false,
    offset: center.offset, elevation: center.elevation,
    kp: kp.status === 'fulfilled' ? kp.value : null,
    ringByEv: events.map((_, k) => ring.filter((r) => r.ev === k)),
  };
  state.d = d;
  d.eventScores = events.map((ev, k) => S.scoreSunEvent({ t: ev.t, center, ring: d.ringByEv[k], aq: aqC, compass: compass(ev.az) }));
  d.hours = computeHours(d);
  d.phen = summarizePhenomena(d);

  setupSlider();
  renderHead();
  renderSky();
  renderHours();
  drawSunLines();
  updateOverlay();
  setBusy('Karten-Overlay wird geladen …');
  map.invalidateSize();
  map.fitBounds(gridBounds, { padding: [10, 10] });

  gridP.then((parts) => {
    if (run !== state.run) return;
    parts.flat().forEach((s, k) => { others[k].s = s; });
    d.gridReady = true;
    d.hours = computeHours(d); // Regenbogen braucht Niederschlag ringsum
    d.phen = summarizePhenomena(d);
    renderSky();
    renderHours();
    updateOverlay();
    setBusy(null);
  }).catch(() => {
    if (run !== state.run) return;
    setBusy(null);
    toast('Karten-Overlay konnte nicht geladen werden – die Prognose für den Ort ist trotzdem gültig.');
  });

  try {
    const raw = await spotsP;
    if (run !== state.run) return;
    state.spots = rateSpots(raw, spotConditions(d));
  } catch {
    state.spots = [];
  }
  if (run === state.run) renderSpots();
}

// Spots: OpenStreetMap + Wikidata parallel, Ergebnis 7 Tage zwischenspeichern (Orte ändern sich selten)
const SPOT_TTL = 7 * 864e5;
async function loadSpots(loc, radiusKm) {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${radiusKm}`;
  const cache = store.get('spotCache') || {};
  const hit = cache[key];
  if (hit && Date.now() - hit.at < SPOT_TTL && hit.complete) {
    state.spotSrc = hit.src;
    return hit.spots.map((s) => ({ ...s, dist: distanceKm(loc, s), brg: bearing(loc, s) }));
  }
  const [osm, wd] = await Promise.allSettled([
    api.fetchSpotsOSM(loc.lat, loc.lon, radiusKm),
    api.fetchSpotsWikidata(loc.lat, loc.lon, radiusKm),
  ]);
  let spots = mergeSpots(
    osm.status === 'fulfilled' ? parseOSM(osm.value, loc) : [],
    wd.status === 'fulfilled' ? parseWikidata(wd.value, loc) : [],
  ).filter((s) => s.dist <= radiusKm * 1.05);
  if (!spots.length) spots = parseWiki(await api.fetchSpotsWiki(loc.lat, loc.lon), loc);
  else if (osm.status !== 'fulfilled') toast('OpenStreetMap ist gerade überlastet – Spots stammen nur aus Wikidata.');
  const complete = osm.status === 'fulfilled' && wd.status === 'fulfilled';
  state.spotSrc = spots[0]?.type === 'wiki' ? 'Wikipedia'
    : [osm.status === 'fulfilled' && 'OpenStreetMap', wd.status === 'fulfilled' && 'Wikidata'].filter(Boolean).join(' + ');
  cache[key] = { at: Date.now(), complete, src: state.spotSrc, spots: spots.map(slimSpot) };
  const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
  for (const k of keys.slice(6)) delete cache[k];
  store.set('spotCache', cache);
  return spots;
}

function computeHours(d) {
  const { center, loc, grid, aq, kp } = d;
  const start = Math.floor(d.now / 3600) * 3600;
  const out = [];
  for (let t = start; t <= start + 24 * 3600; t += 3600) {
    const date = new Date(t * 1000);
    const sp = SunCalc.getPosition(date, loc.lat, loc.lon);
    const sunAlt = deg(sp.altitude), sunAz = sunBearing(sp.azimuth);
    const moonAlt = deg(SunCalc.getMoonPosition(date, loc.lat, loc.lon).altitude);
    const moonFrac = SunCalc.getMoonIllumination(date).fraction;
    const anti = (sunAz + 180) % 360;
    let rainAnti = 0;
    for (const g of grid) {
      if (!g.s || (g.i === (N - 1) / 2 && g.j === (N - 1) / 2)) continue;
      if (angDiff(bearing(loc, g), anti) <= 60) rainAnti = Math.max(rainAnti, S.at(g.s, 'pr', t) ?? 0);
    }
    const kpNow = kp ? (kp.find((k) => t >= k.t && t < k.t + 3 * 3600)?.kp ?? null) : null;
    const aod = aq ? S.at(aq, 'aod', t) : null;
    const dust = aq ? S.at(aq, 'dust', t) : null;
    out.push({
      t, sunAlt, sunAz, moonAlt, moonFrac, kp: kpNow,
      L: S.at(center, 'cl', t), M: S.at(center, 'cm', t), H: S.at(center, 'ch', t), C: S.at(center, 'c', t),
      vis: S.at(center, 'vis', t), ws: S.at(center, 'ws', t), pr: S.at(center, 'pr', t), temp: S.at(center, 'temp', t),
      p: {
        fog: S.fogProb(center, t),
        far: S.farViewProb(center, t, aod, sunAlt),
        rainbow: S.rainbowProb(center, t, sunAlt, rainAnti),
        storm: S.stormProb(center, t),
        stars: S.starsProb(center, t, sunAlt, moonAlt, moonFrac),
        aurora: S.auroraProb(kpNow, loc.lat, sunAlt, S.at(center, 'c', t)),
        dust: sunAlt > -6 ? S.dustSkyProb(dust) : 0,
      },
    });
  }
  return out;
}

const PHEN = [
  { key: 'fog', icon: '🌫️', name: 'Nebel / Nebelmeer', tip: 'Feucht, kaum Wind, Taupunkt nah an der Temperatur. Von erhöhten Punkten aus ist ein Nebelmeer möglich.' },
  { key: 'far', icon: '🔭', name: 'Fernsicht', tip: 'Trockene, saubere Luft und hohe Sichtweite – ideal für Panoramen und Bergketten.' },
  { key: 'rainbow', icon: '🌈', name: 'Regenbogen', tip: 'Tiefe Sonne im Rücken, Schauer auf der gegenüberliegenden Seite.' },
  { key: 'storm', icon: '⛈️', name: 'Gewitterstimmung', tip: 'Labile Luft (CAPE) – dramatische Wolkentürme, evtl. Mammatus oder Blitze.' },
  { key: 'stars', icon: '✨', name: 'Sternenhimmel / Milchstraße', tip: 'Dunkle Nacht, klarer Himmel, wenig Mondlicht.' },
  { key: 'aurora', icon: '🌌', name: 'Polarlicht', tip: 'Abhängig vom Kp-Index (NOAA). In Mitteleuropa erst ab ca. Kp 6–7 und meist nur auf Kamerafotos.' },
  { key: 'dust', icon: '🟡', name: 'Saharastaub (gelber Himmel)', tip: 'Staub in der Atmosphäre färbt den Himmel milchig gelb bis orange.' },
];

function summarizePhenomena(d) {
  return PHEN.map((ph) => {
    let max = 0, tMax = null;
    for (const h of d.hours) if (h.p[ph.key] > max) { max = h.p[ph.key]; tMax = h.t; }
    const good = d.hours.filter((h) => h.p[ph.key] >= Math.max(15, max * 0.7));
    return { ...ph, max: Math.round(max), tMax, from: good[0]?.t ?? null, to: good.length ? good[good.length - 1].t : null };
  }).sort((a, b) => b.max - a.max);
}

function spotConditions(d) {
  const best = d.eventScores.reduce((a, s, k) => (s.overall > (a?.s.overall ?? -1) ? { s, ev: d.events[k] } : a), null);
  const day = d.hours.filter((h) => h.sunAlt > 0);
  const mean = (arr, f) => (arr.length ? arr.reduce((a, x) => a + (f(x) ?? 0), 0) / arr.length : 0);
  const ph = Object.fromEntries(d.phen.map((p) => [p.key, p.max]));
  return {
    elevation: d.elevation,
    radius: state.radius,
    color: best?.s.overall ?? 0,
    colorLabel: best ? `${best.ev.kind === 'set' ? 'Abendrot' : 'Morgenrot'} ${best.s.overall} %` : '',
    calm: d.eventScores.some((s) => (s.calm ?? 0) >= 70),
    fog: ph.fog, farView: ph.far, stars: ph.stars,
    overcast: mean(day, (h) => h.C) >= 75,
    recentRain: S.sumBefore(d.center, 'pr', d.now, 6) > 1,
    events: d.events,
  };
}

// ---------- Darstellung: Kopf, Himmel, Verlauf, Spots ----------
function renderHead() {
  const d = state.d, loc = state.loc;
  if (!loc) return;
  const name = loc.name || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
  const elev = d?.elevation != null ? ` · ${Math.round(d.elevation)} m` : '';
  const upd = d ? ` · Stand ${fmtTime(d.now)}` : '';
  $('#locHead').innerHTML = `<h1>${esc(name)}</h1><p>${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}${elev}${upd} · Umkreis ${state.radius} km</p>`;
}

const bar = (label, v, cls = '') =>
  `<div class="bar ${cls}"><span class="bl">${label}</span><span class="bt"><i style="width:${Math.max(2, v)}%"></i></span><span class="bv">${v} %</span></div>`;

function ring(v) {
  const c = 2 * Math.PI * 26;
  return `<svg class="ring" viewBox="0 0 64 64" aria-label="${v} von 100"><circle cx="32" cy="32" r="26" class="rb"/>` +
    `<circle cx="32" cy="32" r="26" class="rf" style="stroke-dasharray:${(v / 100) * c} ${c}"/><text x="32" y="37">${v}</text></svg>`;
}

function renderSky() {
  const d = state.d;
  const range = ([a, b]) => (a && b ? `${fmtTime(a)}–${fmtTime(b)}` : '–');
  const cards = d.events.map((ev, k) => {
    const sc = d.eventScores[k];
    const title = ev.kind === 'set' ? '🌇 Sonnenuntergang' : '🌅 Sonnenaufgang';
    const why = sc.why.map(([ok, txt]) => `<li class="${ok ? 'ok' : 'no'}">${esc(txt)}</li>`).join('');
    return `<article class="card event" data-t="${ev.t}">
      <header>${ring(sc.overall)}<div><h3>${title}</h3>
        <p class="sub">${fmtDay(ev.t)} ${fmtTime(ev.t)} · Richtung ${compass(ev.az)} (${Math.round(ev.az)}°)</p>
        <p class="verdict">${S.verdict(sc.overall)}</p></div></header>
      ${bar('Roter Himmel', sc.red, 'red')}
      ${bar('Gelber Himmel', sc.yellow, 'yellow')}
      ${bar('Sonne sichtbar', sc.sunVis, 'sun')}
      ${sc.calm != null ? bar('Windstill / Spiegelung', sc.calm, 'calm') : ''}
      <p class="times">Goldene Stunde ${range(ev.golden)} · Blaue Stunde ≈ ${range(ev.blue)}</p>
      <ul class="why">${why}</ul>
      <button class="btn small" data-jump="${ev.t}">Auf Karte zeigen</button>
    </article>`;
  }).join('') || '<p class="muted">In den nächsten 24 Stunden gibt es hier keinen Sonnenauf- oder -untergang.</p>';

  const phen = d.phen.map((p) => {
    const when = p.max >= 15 && p.from ? `${fmtDay(p.from)} ${fmtTime(p.from)}${p.to !== p.from ? `–${fmtTime(p.to)}` : ''}` : 'unwahrscheinlich';
    return `<div class="phen ${p.max < 15 ? 'dim' : ''}" ${p.tMax ? `data-jump="${p.tMax}"` : ''}>
      <span class="pi">${p.icon}</span>
      <div><b>${p.name}</b><small>${esc(when)}</small><p>${esc(p.tip)}</p></div>
      <span class="pv">${p.max} %</span></div>`;
  }).join('');

  $('#tab-sky').innerHTML = `<h2>Sonnenauf- &amp; -untergang</h2>${cards}<h2>Weitere Phänomene (24 h)</h2><div class="phens">${phen}</div>
    <p class="note">Werte sind Schätzungen aus Wettermodellen – kein Versprechen. Am zuverlässigsten 0–12 Stunden im Voraus.</p>`;
}

function renderHours() {
  const d = state.d;
  const rows = [];
  for (const h of d.hours) {
    const top = PHEN.filter((p) => h.p[p.key] >= 40).map((p) => `<span class="chip" title="${p.name}">${p.icon} ${Math.round(h.p[p.key])}</span>`).join('');
    const cb = (v) => `<i style="height:${Math.max(4, v ?? 0)}%"></i>`;
    rows.push(`<li data-jump="${h.t}">
      <span class="ht"><b>${fmtTime(h.t)}</b><small>${h.sunAlt > 0 ? '☀️' : '🌙'} ${Math.round(h.sunAlt)}°</small></span>
      <span class="cl" title="Wolken tief/mittel/hoch: ${Math.round(h.L ?? 0)}/${Math.round(h.M ?? 0)}/${Math.round(h.H ?? 0)} %">${cb(h.L)}${cb(h.M)}${cb(h.H)}</span>
      <span class="hv">${h.temp != null ? Math.round(h.temp) + '°' : ''}<small>${h.vis != null ? Math.round(h.vis / 1000) + ' km' : ''}</small></span>
      <span class="hv">${h.ws != null ? Math.round(h.ws) : '–'}<small>km/h</small></span>
      <span class="hv">${h.pr ? h.pr.toFixed(1) : '0'}<small>mm</small></span>
      <span class="chips">${top}</span></li>`);
    for (const ev of d.events) {
      if (ev.t >= h.t && ev.t < h.t + 3600) {
        rows.push(`<li class="evrow" data-jump="${ev.t}">${ev.kind === 'set' ? '🌇 Sonnenuntergang' : '🌅 Sonnenaufgang'} ${fmtTime(ev.t)}</li>`);
      }
    }
  }
  $('#tab-hours').innerHTML = `<div class="hhead"><span>Zeit</span><span>Wolken T/M/H</span><span>Temp</span><span>Wind</span><span>Regen</span><span></span></div><ul class="hours">${rows.join('')}</ul>`;
}

function renderSpots() {
  spotLayer.clearLayers();
  const spots = state.spots || [];
  const el = $('#tab-spots');
  if (!spots.length) {
    el.innerHTML = '<p class="muted">Keine Foto-Spots im Umkreis gefunden.</p>';
    return;
  }
  spots.slice(0, 30).forEach((s, idx) => {
    const T = SPOT_TYPES[s.type];
    const size = s.score >= 70 ? 34 : s.score >= 50 ? 28 : 22;
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: 'spot-pin', html: `<span style="width:${size}px;height:${size}px;font-size:${size * 0.55}px">${T.icon}</span>`, iconSize: [size, size] }),
      zIndexOffset: 100 - idx, title: s.name || T.label,
    }).addTo(spotLayer);
    m.bindPopup(() => spotPopup(s), { maxWidth: 280, minWidth: 220, maxHeight: 340 });
    m.on('popupopen', (e) => loadWiki(s, e.popup));
    s.marker = m;
  });
  el.innerHTML = `<p class="muted small">${spots.length} Orte aus ${esc(state.spotSrc || 'OpenStreetMap')}, bewertet nach Bekanntheit, Entfernung und heutiger Wetterlage.</p><ul class="spots">${
    spots.slice(0, 30).map((s, k) => {
      const T = SPOT_TYPES[s.type];
      return `<li data-spot="${k}"><span class="si">${T.icon}</span><div><b>${esc(s.name || T.label)}</b>
        <small>${T.label}${s.ele ? ` · ${Math.round(s.ele)} m` : ''} · ${s.dirText}</small>
        ${s.fit.length ? `<p>${s.fit.map(esc).join(' · ')}</p>` : ''}</div><span class="sv">${s.score}</span></li>`;
    }).join('')}</ul>`;
}

function wikiBlock(s) {
  if (!s.wiki) return '';
  if (s.wikiData === undefined) return '<span class="muted">Wikipedia wird geladen …</span>';
  const w = s.wikiData;
  if (!w) return s.wdUrl ? `<a href="${s.wdUrl}" target="_blank" rel="noopener">Wikidata</a>` : '';
  const text = w.extract.length > 260 ? `${w.extract.slice(0, 260)}…` : w.extract;
  return `${w.thumb && !s.img ? `<img src="${esc(w.thumb)}" alt="">` : ''}<p>${esc(text)}</p>` +
    `<a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia</a>`;
}

function spotPopup(s) {
  const T = SPOT_TYPES[s.type];
  const nav = `https://maps.apple.com/?daddr=${s.lat},${s.lon}`;
  const gm = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  return `<div class="popup"><b>${T.icon} ${esc(s.name || T.label)}</b>
    <small>${T.label}${s.ele ? ` · ${Math.round(s.ele)} m` : ''} · ${s.dirText} · Score ${s.score}</small>
    ${s.fit.length ? `<ul>${s.fit.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${s.img ? `<img src="${esc(s.img)}?width=480" alt="">` : ''}
    <div class="wiki">${wikiBlock(s)}</div>
    <p class="links"><a href="${nav}" target="_blank" rel="noopener">Apple Karten</a> · <a href="${gm}" target="_blank" rel="noopener">Google Maps</a>${s.osm ? ` · <a href="${s.osm}" target="_blank" rel="noopener">OSM</a>` : ''}</p></div>`;
}

async function loadWiki(s, popup) {
  if (!s.wiki || s.wikiData !== undefined) return;
  try {
    s.wikiData = await api.wikiSummary(s.tags);
  } catch {
    s.wikiData = null;
  }
  if (popup.isOpen()) popup.setContent(spotPopup(s));
}

// ---------- Karten-Overlay ----------
const LAYERS = {
  color: { name: 'Abend-/Morgenrot', unit: '%', stops: [[0, [255, 210, 90, 0]], [15, [255, 210, 90, 0.12]], [35, [255, 170, 60, 0.38]], [55, [255, 110, 50, 0.5]], [75, [225, 40, 70, 0.58]], [100, [150, 30, 150, 0.65]]], legend: ['0', '50', '100 %'] },
  fog: { name: 'Nebelrisiko', stops: [[0, [190, 200, 215, 0]], [20, [190, 200, 215, 0.1]], [60, [205, 212, 225, 0.5]], [100, [235, 238, 245, 0.78]]], legend: ['0', '50', '100 %'] },
  cl: { name: 'Wolken tief', stops: [[0, [50, 60, 85, 0]], [15, [50, 60, 85, 0.15]], [100, [50, 60, 85, 0.75]]], legend: ['0', '50', '100 %'] },
  cm: { name: 'Wolken mittel', stops: [[0, [75, 85, 120, 0]], [15, [75, 85, 120, 0.15]], [100, [75, 85, 120, 0.72]]], legend: ['0', '50', '100 %'] },
  ch: { name: 'Wolken hoch', stops: [[0, [105, 115, 165, 0]], [15, [105, 115, 165, 0.15]], [100, [105, 115, 165, 0.72]]], legend: ['0', '50', '100 %'] },
  vis: { name: 'Sichtweite', stops: [[0, [110, 110, 120, 0.7]], [2000, [140, 140, 150, 0.5]], [8000, [170, 170, 180, 0.25]], [20000, [90, 200, 150, 0.05]], [40000, [70, 190, 140, 0.25]]], legend: ['0', '10', '40 km'] },
  pr: { name: 'Niederschlag', stops: [[0, [60, 120, 230, 0]], [0.1, [60, 120, 230, 0.25]], [1, [50, 100, 230, 0.5]], [5, [110, 40, 200, 0.7]]], legend: ['0', '1', '5 mm/h'] },
};

function colorAt(stops, v) {
  if (v == null || Number.isNaN(v)) return [0, 0, 0, 0];
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const f = (v - a) / (b - a);
      return ca.map((x, k) => x + (cb[k] - x) * f);
    }
  }
  return stops[stops.length - 1][1];
}

function cellValues(t) {
  const d = state.d;
  const L = state.layer;
  if (L === 'color') {
    if (!d.events.length) return d.grid.map(() => 0);
    let k = 0;
    d.events.forEach((ev, i) => { if (Math.abs(ev.t - t) < Math.abs(d.events[k].t - t)) k = i; });
    const prox = S.pl(Math.abs(d.events[k].t - t) / 60, [[0, 1], [45, 1], [90, 0.5], [150, 0.12]]);
    const gap = S.gapFactor(d.ringByEv[k], t);
    const aod = d.aq ? S.at(d.aq, 'aod', t) : null;
    return d.grid.map((g) => S.colorScoreCell(g.s, t, gap, aod) * prox);
  }
  if (L === 'fog') return d.grid.map((g) => S.fogProb(g.s, t));
  return d.grid.map((g) => S.at(g.s, L, t));
}

const cv = document.createElement('canvas');
cv.width = cv.height = 140;
function updateOverlay() {
  const d = state.d;
  if (!d) return;
  if (!d.gridReady) {
    renderLegend();
    renderTimeLabel();
    drawSunNow();
    return;
  }
  const vals = cellValues(state.t);
  const stops = LAYERS[state.layer].stops;
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const v = (i, j) => vals[i * N + j];
  for (let y = 0; y < H; y++) {
    const gy = (y / (H - 1)) * (N - 1), i0 = Math.min(N - 2, Math.floor(gy)), fy = gy - i0;
    for (let x = 0; x < W; x++) {
      const gx = (x / (W - 1)) * (N - 1), j0 = Math.min(N - 2, Math.floor(gx)), fx = gx - j0;
      const val = (v(i0, j0) ?? 0) * (1 - fx) * (1 - fy) + (v(i0, j0 + 1) ?? 0) * fx * (1 - fy) +
        (v(i0 + 1, j0) ?? 0) * (1 - fx) * fy + (v(i0 + 1, j0 + 1) ?? 0) * fx * fy;
      const c = colorAt(stops, val);
      // Kreisförmig auf den Umkreis begrenzen, Rand weich ausblenden
      const edge = (1 - Math.hypot((x / (W - 1)) * 2 - 1, (y / (H - 1)) * 2 - 1)) / 0.15;
      const o = (y * W + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
      img.data[o + 3] = 255 * c[3] * Math.max(0, Math.min(1, edge));
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  if (!overlay) overlay = L.imageOverlay(url, gridBounds, { interactive: false, className: 'wx-overlay' }).addTo(map);
  else { overlay.setUrl(url); overlay.setBounds(gridBounds); }
  renderLegend();
  renderTimeLabel();
  drawSunNow();
}

function renderLegend() {
  const Ly = LAYERS[state.layer];
  const max = Ly.stops[Ly.stops.length - 1][0];
  const grad = Ly.stops.map(([v, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.15, c[3])}) ${(v / max) * 100}%`).join(',');
  $('#legend').innerHTML = `<span class="lg" style="background:linear-gradient(90deg,${grad})"></span><span class="ll">${Ly.legend.map((x) => `<i>${x}</i>`).join('')}</span>`;
}

function setupSlider() {
  const d = state.d;
  const s = $('#time');
  const start = d.hours[0].t;
  s.min = start; s.max = start + 24 * 3600; s.step = 300;
  const next = d.events.find((e) => e.t > d.now - 1800);
  state.t = next && next.t - d.now < 12 * 3600 ? next.t : Math.max(start, Math.round(d.now / 300) * 300);
  s.value = state.t;
  const rise = d.events.find((e) => e.kind === 'rise'), set = d.events.find((e) => e.kind === 'set');
  $('#jumpRise').disabled = !rise; $('#jumpRise').dataset.jump = rise?.t ?? '';
  $('#jumpSet').disabled = !set; $('#jumpSet').dataset.jump = set?.t ?? '';
}

function renderTimeLabel() {
  const d = state.d, t = state.t;
  const sp = SunCalc.getPosition(new Date(t * 1000), d.loc.lat, d.loc.lon);
  const alt = Math.round(deg(sp.altitude));
  $('#timeLabel').textContent = `${fmtDay(t)} ${fmtTime(t)} · Sonne ${alt}° ${compass(sunBearing(sp.azimuth))}`;
}

function drawSunLines() {
  sunLayer.clearLayers();
  const d = state.d, len = state.radius * 1.35;
  for (const ev of d.events) {
    const end = destination(d.loc, ev.az, len);
    const color = ev.kind === 'set' ? '#ff5a36' : '#ffc23d';
    L.polyline([[d.loc.lat, d.loc.lon], [end.lat, end.lon]], { color, weight: 3, opacity: 0.9, interactive: false }).addTo(sunLayer);
    L.marker([end.lat, end.lon], {
      icon: L.divIcon({ className: 'sun-label', html: `<span style="border-color:${color}">${ev.kind === 'set' ? '🌇' : '🌅'} ${fmtTime(ev.t)}</span>`, iconSize: [70, 22], iconAnchor: [35, 11] }),
      interactive: false,
    }).addTo(sunLayer);
  }
}

let sunNowLine = null;
function drawSunNow() {
  const d = state.d;
  if (sunNowLine) { sunNowLine.remove(); sunNowLine = null; }
  const sp = SunCalc.getPosition(new Date(state.t * 1000), d.loc.lat, d.loc.lon);
  if (deg(sp.altitude) < -1) return;
  const end = destination(d.loc, sunBearing(sp.azimuth), state.radius * 1.1);
  sunNowLine = L.polyline([[d.loc.lat, d.loc.lon], [end.lat, end.lon]], { color: '#ffe680', weight: 2, dashArray: '6 6', interactive: false }).addTo(map);
}

// ---------- UI-Verdrahtung ----------
function setBusy(msg) {
  document.body.classList.toggle('busy', !!msg);
  $('#busy').textContent = msg || '';
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

function setTime(t) {
  state.t = +t;
  $('#time').value = state.t;
  updateOverlay();
}

document.addEventListener('click', (e) => {
  const j = e.target.closest('[data-jump]');
  if (j && j.dataset.jump) {
    setTime(j.dataset.jump);
    if (window.matchMedia('(max-width: 899px)').matches) $('#map').scrollIntoView({ behavior: 'smooth' });
  }
  const sp = e.target.closest('[data-spot]');
  if (sp && state.spots) {
    const s = state.spots[+sp.dataset.spot];
    map.setView([s.lat, s.lon], Math.max(map.getZoom(), 13));
    s.marker?.openPopup();
    if (window.matchMedia('(max-width: 899px)').matches) $('#map').scrollIntoView({ behavior: 'smooth' });
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b === tab));
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== `tab-${tab.dataset.tab}`; });
  }
});

$('#time').addEventListener('input', (e) => setTime(e.target.value));
$('#layer').innerHTML = Object.entries(LAYERS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
$('#layer').addEventListener('change', (e) => { state.layer = e.target.value; updateOverlay(); });
$('#radius').value = String(state.radius);
$('#radius').addEventListener('change', (e) => {
  state.radius = +e.target.value;
  store.set('radius', state.radius);
  if (state.loc) analyze(state.loc);
});

$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  const list = $('#results');
  try {
    const res = await api.searchPlace(q);
    if (!res.length) { toast('Ort nicht gefunden.'); return; }
    if (res.length === 1) { list.hidden = true; analyze(res[0]); return; }
    list.innerHTML = res.map((r, k) => `<li><button type="button" data-res="${k}"><b>${esc(r.name)}</b><small>${esc(r.detail)}</small></button></li>`).join('');
    list.hidden = false;
    list.onclick = (ev) => {
      const b = ev.target.closest('[data-res]');
      if (!b) return;
      list.hidden = true;
      $('#q').blur();
      analyze(res[+b.dataset.res]);
    };
  } catch {
    toast('Suche fehlgeschlagen.');
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.topbar')) $('#results').hidden = true; });

function locate() {
  if (!navigator.geolocation) { toast('Standort wird von diesem Browser nicht unterstützt.'); return; }
  setBusy('Standort wird bestimmt …');
  navigator.geolocation.getCurrentPosition(
    (p) => analyze({ lat: p.coords.latitude, lon: p.coords.longitude, name: null }),
    () => { setBusy(null); toast('Standort nicht verfügbar – bitte Freigabe prüfen oder Ort suchen.'); },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
  );
}
$('#gps').addEventListener('click', locate);

const saved = store.get('loc');
if (saved && Number.isFinite(saved.lat)) {
  analyze(saved);
} else {
  $('#tab-sky').innerHTML = $('#welcome').innerHTML;
  $('#tab-sky').querySelector('[data-act="gps"]')?.addEventListener('click', locate);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
