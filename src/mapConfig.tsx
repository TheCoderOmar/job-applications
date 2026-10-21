import L from 'leaflet';
import { TileLayer } from 'react-leaflet';

// Esri "Dark Gray Canvas" — free, no API key. Base + labels are separate layers.
const BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

export function DarkTiles() {
  return (
    <>
      <TileLayer url={BASE} attribution={ATTRIBUTION} maxNativeZoom={16} maxZoom={19} className="tiles-base" />
      <TileLayer url={LABELS} maxNativeZoom={16} maxZoom={19} pane="overlayPane" />
    </>
  );
}

const icons = {
  onsite: L.divIcon({ className: '', html: '<div class="pin pin-onsite"></div>', iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10] }),
  remote: L.divIcon({ className: '', html: '<div class="pin pin-remote"></div>', iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10] }),
};

export const pinIcon = (remote: boolean) => (remote ? icons.remote : icons.onsite);

export const homeIcon = L.divIcon({
  className: '',
  html: '<div class="home-pin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10"/></svg></div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -16],
});

/** Straight-line (great-circle) distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const formatKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()) + ' km';
