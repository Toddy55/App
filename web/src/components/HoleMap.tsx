import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hole, LatLon } from '../types';
import { distanceM, fmtDist } from '../lib/geo';

interface Props {
  hole?: Hole;
  player?: LatLon;
  pin?: LatLon;
  shots?: LatLon[];
  centre?: LatLon;
  units: 'm' | 'yd';
  /** Called when the map is tapped. */
  onTap?: (p: LatLon) => void;
  /** Show a measuring line from player to the tapped point and on to the green. */
  measure?: LatLon;
  height?: number | string;
}

const dot = (cls: string) => L.divIcon({ className: '', html: `<div class="mk ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
const label = (text: string) =>
  L.divIcon({ className: '', html: `<div class="mk-label">${text}</div>`, iconSize: [60, 22], iconAnchor: [30, 26] });

/** Satellite hole map (Esri World Imagery) with player, green, pin and shot markers. */
export function HoleMap({ hole, player, pin, shots, centre, units, onTap, measure, height = 320 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const fittedFor = useRef<string>('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
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
    if (green?.polygon) L.polygon(green.polygon.map(ll), { color: '#7CFC9A', weight: 2, fillOpacity: 0.15 }).addTo(g);
    if (green) L.marker(ll(green.centre), { icon: dot('green') }).addTo(g);
    if (hole?.tee) L.marker(ll(hole.tee), { icon: dot('tee') }).addTo(g);
    if (pin) L.marker(ll(pin), { icon: L.divIcon({ className: '', html: '<div class="mk-flag">⛳</div>', iconSize: [24, 24], iconAnchor: [6, 22] }) }).addTo(g);
    (shots ?? []).forEach((s, i) => {
      L.marker(ll(s), { icon: L.divIcon({ className: '', html: `<div class="mk shot">${i + 1}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(g);
    });
    if (shots && shots.length > 1) L.polyline(shots.map(ll), { color: '#fff', weight: 1.5, dashArray: '4 4' }).addTo(g);
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
  }, [hole, player, pin, shots, measure, units, centre]);

  return <div ref={el} className="hole-map" style={{ height }} />;
}
