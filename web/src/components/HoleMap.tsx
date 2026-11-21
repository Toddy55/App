import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hazard, Hole, LatLon } from '../types';
import { distanceM, fmtDist } from '../lib/geo';
import { arcLatLngs, shotLegs } from '../lib/tracer';
import { ESRI, QLD_AERIAL } from '../lib/holeFrame';
import { inQueensland } from '../lib/greenDem';

interface Props {
  hole?: Hole;
  player?: LatLon;
  pin?: LatLon;
  shots?: (LatLon & { club?: string })[];
  /** Draw the last shot on to the green (for replays of finished holes). */
  finishToGreen?: boolean;
  /** Animate the shot tracers one after another. */
  animate?: boolean;
  centre?: LatLon;
  units: 'm' | 'yd';
  /** Called when the map is tapped. */
  onTap?: (p: LatLon) => void;
  /** Show a measuring line from player to the tapped point and on to the green. */
  measure?: LatLon;
  height?: number | string;
  /** Bunkers, water and fairways to shade. */
  hazards?: Hazard[];
  /** Caddy's aim point and the zone most shots will finish in. */
  aim?: LatLon;
  landingZone?: LatLon[];
}

const dot = (cls: string) => L.divIcon({ className: '', html: `<div class="mk ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
const label = (text: string) =>
  L.divIcon({ className: '', html: `<div class="mk-label">${text}</div>`, iconSize: [60, 22], iconAnchor: [30, 26] });

/** Satellite hole map (Esri World Imagery) with player, green, pin and shot markers. */
export function HoleMap({ hole, player, pin, shots, centre, units, onTap, measure, height = 320, finishToGreen, animate, hazards, aim, landingZone }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const fittedFor = useRef<string>('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true });
    // Sharper Queensland Government aerial photos on Queensland courses (unless switched to Esri)
    let pref = 'qld';
    try {
      pref = localStorage.getItem('gtg.imagery') ?? 'qld';
    } catch {
      /* ignore */
    }
    const qld = pref !== 'esri' && !!centre && inQueensland(centre);
    const src = qld ? QLD_AERIAL : ESRI;
    L.tileLayer(src.url(-1, -1, -1).replace('/-1/-1/-1', '/{z}/{y}/{x}'), {
      maxZoom: src.maxZoom + 1,
      maxNativeZoom: src.maxZoom,
      attribution: qld ? src.credit : 'Imagery © Esri, Maxar, Earthstar Geographics',
    }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => tapRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.setView([centre?.lat ?? -25.27, centre?.lon ?? 133.77], centre ? 16 : 4);
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const ll = (p: LatLon) => L.latLng(p.lat, p.lon);
    const green = hole?.green;
    // Course features under everything else
    for (const z of hazards ?? []) {
      const style =
        z.kind === 'water'
          ? { color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.35 }
          : z.kind === 'bunker'
            ? { color: '#e8d5a0', weight: 1, fillColor: '#f3e3b5', fillOpacity: 0.55 }
            : { color: '#86efac', weight: 0.5, fillColor: '#86efac', fillOpacity: 0.12 };
      L.polygon(z.poly.map(ll), { ...style, interactive: false }).addTo(g);
    }
    if (landingZone) L.polygon(landingZone.map(ll), { color: '#c6f432', weight: 2, dashArray: '5 5', fillColor: '#c6f432', fillOpacity: 0.12, interactive: false }).addTo(g);
    if (aim && player) L.polyline([ll(player), ll(aim)], { color: '#c6f432', weight: 2, opacity: 0.9, interactive: false }).addTo(g);
    if (aim) L.marker(ll(aim), { icon: L.divIcon({ className: '', html: '<div class="mk-aim"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(g);
    if (green?.polygon) L.polygon(green.polygon.map(ll), { color: '#7CFC9A', weight: 2, fillOpacity: 0.15 }).addTo(g);
    if (green) L.marker(ll(green.centre), { icon: dot('green') }).addTo(g);
    if (hole?.tee) L.marker(ll(hole.tee), { icon: dot('tee') }).addTo(g);
    if (pin) L.marker(ll(pin), { icon: L.divIcon({ className: '', html: '<div class="mk-flag">⛳</div>', iconSize: [24, 24], iconAnchor: [6, 22] }) }).addTo(g);
    // Shot tracers: a curved flight line per shot, labelled with club and distance
    shotLegs(shots ?? [], finishToGreen ? green?.centre : undefined).forEach((leg, i) => {
      const line = L.polyline(arcLatLngs(leg.from, leg.to).map(ll), {
        color: '#ffd166',
        weight: 3.5,
        opacity: 0.95,
        className: animate ? 'tracer-line animate' : 'tracer-line',
      }).addTo(g);
      const el = line.getElement() as SVGPathElement | undefined;
      if (el && animate) {
        el.setAttribute('pathLength', '1');
        el.style.animationDelay = `${i * 0.9}s`;
      }
      const mid = arcLatLngs(leg.from, leg.to)[12];
      L.marker(ll(mid), {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<div class="mk-shot-label">${leg.club ? `${leg.club} · ` : ''}${fmtDist(leg.distance, units)}${units}</div>`,
          iconSize: [90, 20],
          iconAnchor: [45, 10],
        }),
      }).addTo(g);
    });
    (shots ?? []).forEach((s, i) => {
      L.marker(ll(s), { icon: L.divIcon({ className: '', html: `<div class="mk shot">${i + 1}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(g);
    });
    if (player) L.marker(ll(player), { icon: dot('me') }).addTo(g);
    const target = pin ?? green?.centre;
    if (measure && player) {
      L.polyline([ll(player), ll(measure)], { color: '#FFD166', weight: 3 }).addTo(g);
      L.marker(ll(measure), { icon: dot('measure') }).addTo(g);
      L.marker(ll(measure), { icon: label(`${fmtDist(distanceM(player, measure), units)}${units}`) }).addTo(g);
      if (target) {
        L.polyline([ll(measure), ll(target)], { color: '#FFD166', weight: 2, dashArray: '6 6' }).addTo(g);
        const mid = { lat: (measure.lat + target.lat) / 2, lon: (measure.lon + target.lon) / 2 };
        L.marker(ll(mid), { icon: label(`${fmtDist(distanceM(measure, target), units)}${units}`) }).addTo(g);
      }
    }

    // Fit the view once per hole.
    const key = `${hole?.number ?? 'x'}`;
    if (fittedFor.current !== key) {
      const pts: LatLon[] = [];
      if (hole?.tee) pts.push(hole.tee);
      if (green) pts.push(green.centre, ...(green.polygon ?? []));
      if (player && green && distanceM(player, green.centre) < 700) pts.push(player);
      if (pts.length >= 2) {
        m.fitBounds(L.latLngBounds(pts.map(ll)), { padding: [30, 30], maxZoom: 19, animate: false });
        fittedFor.current = key;
      } else if (pts.length === 1 || player || centre) {
        const p = pts[0] ?? player ?? centre!;
        m.setView(ll(p), 17, { animate: false });
        fittedFor.current = key;
      }
    }
  }, [hole, player, pin, shots, measure, units, centre, finishToGreen, animate, hazards, aim, landingZone]);

  return <div ref={el} className="hole-map" style={{ height }} />;
}
