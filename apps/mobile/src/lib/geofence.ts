/** Pure geofence helpers (mirror of apps/api/src/sites/geofence.ts, E2-S07 / E4-S05). */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Geofence extends GeoPoint {
  radiusM: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Point exactly on the boundary passes (FR-16/FR-17). */
export function evaluateGeofence(
  point: GeoPoint,
  fence: Geofence,
): { withinFence: boolean; distanceM: number } {
  const distanceM = distanceMeters(point, fence);
  return { withinFence: distanceM <= fence.radiusM, distanceM };
}
