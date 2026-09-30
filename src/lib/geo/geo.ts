export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface MapWaypoint {
  label: string;
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "12.34567, 98.76543" — the copy-paste coordinate format. */
export function formatCoord(point: GeoPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

export interface CalibrationPointLike {
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface CalibrationLike {
  p1: CalibrationPointLike;
  p2: CalibrationPointLike;
}

function calibrationScales(cal: CalibrationLike): {
  latPerPx: number;
  lngPerPx: number;
} | null {
  const dx = cal.p2.x - cal.p1.x;
  const dy = cal.p2.y - cal.p1.y;
  if (dx === 0 || dy === 0) return null;
  const dLat = cal.p2.lat - cal.p1.lat;
  const dLng = cal.p2.lng - cal.p1.lng;
  if (dLat === 0 || dLng === 0) return null;
  return { latPerPx: dLat / dy, lngPerPx: dLng / dx };
}

/** Pixel → lat/lng using the two-point linear calibration. */
export function pxToLatLng(
  cal: CalibrationLike,
  x: number,
  y: number,
): GeoPoint | null {
  const scales = calibrationScales(cal);
  if (!scales) return null;
  return {
    lat: cal.p1.lat + (y - cal.p1.y) * scales.latPerPx,
    lng: cal.p1.lng + (x - cal.p1.x) * scales.lngPerPx,
  };
}

/** lat/lng → pixel using the two-point linear calibration. */
export function latLngToPx(
  cal: CalibrationLike,
  point: GeoPoint,
): { x: number; y: number } | null {
  const scales = calibrationScales(cal);
  if (!scales) return null;
  return {
    x: cal.p1.x + (point.lng - cal.p1.lng) / scales.lngPerPx,
    y: cal.p1.y + (point.lat - cal.p1.lat) / scales.latPerPx,
  };
}

export function bounds(points: GeoPoint[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  const usable = points.filter(
    (p) => p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (usable.length === 0) return null;
  let minLat = usable[0]!.lat;
  let maxLat = usable[0]!.lat;
  let minLng = usable[0]!.lng;
  let maxLng = usable[0]!.lng;
  for (const p of usable) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Waypoints → GPX 1.1 with one <wpt> per waypoint. */
export function toGpx(waypoints: MapWaypoint[], routeName = "OffGrid waypoints"): string {
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lng.toFixed(7)}"><name>${escapeXml(w.label)}</name></wpt>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OffGrid" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(routeName)}</name></metadata>
${wpts}
</gpx>
`;
}

const WPT_RE =
  /<wpt[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;
const WPT_RE_LOOSE =
  /<wpt[^>]*\blon="([^"]+)"[^>]*\blat="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;
const NAME_RE = /<name[^>]*>([\s\S]*?)<\/name>/i;

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Parse GPX text into waypoints (lat/lon attributes in either order). */
export function fromGpx(xml: string): MapWaypoint[] {
  const out: MapWaypoint[] = [];
  for (const match of xml.matchAll(WPT_RE)) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    const nameMatch = match[3]?.match(NAME_RE);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({
        label: nameMatch ? unescapeXml(nameMatch[1]!.trim()) : `Waypoint ${out.length + 1}`,
        lat,
        lng,
      });
    }
  }
  if (out.length > 0) return out;
  for (const match of xml.matchAll(WPT_RE_LOOSE)) {
    const lng = Number(match[1]);
    const lat = Number(match[2]);
    const nameMatch = match[3]?.match(NAME_RE);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push({
        label: nameMatch ? unescapeXml(nameMatch[1]!.trim()) : `Waypoint ${out.length + 1}`,
        lat,
        lng,
      });
    }
  }
  return out;
}

export const WAYPOINT_EXPORT_FORMAT = "offgrid-map";
export const WAYPOINT_EXPORT_VERSION = 1;

export interface WaypointExportFile {
  format: typeof WAYPOINT_EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  waypoints: MapWaypoint[];
}

export function toWaypointJson(waypoints: MapWaypoint[]): string {
  const file: WaypointExportFile = {
    format: WAYPOINT_EXPORT_FORMAT,
    version: WAYPOINT_EXPORT_VERSION,
    exportedAt: Date.now(),
    waypoints,
  };
  return JSON.stringify(file, null, 2);
}

/** Parse OffGrid's own JSON export (throws via caller catching on bad shape). */
export function fromWaypointJson(json: string): MapWaypoint[] {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { format?: unknown }).format !== WAYPOINT_EXPORT_FORMAT
  ) {
    throw new Error("Not an OffGrid waypoint export");
  }
  const list = (parsed as { waypoints?: unknown }).waypoints;
  if (!Array.isArray(list)) throw new Error("Export has no waypoints");
  return list.flatMap((raw): MapWaypoint[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const w = raw as { label?: unknown; lat?: unknown; lng?: unknown };
    const lat = Number(w.lat);
    const lng = Number(w.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{ label: typeof w.label === "string" ? w.label : "Waypoint", lat, lng }];
  });
}
