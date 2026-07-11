import { distanceMeters, evaluateGeofence } from './geofence';

// BGC, Taguig — a plausible PH construction site.
const SITE = { lat: 14.5513, lng: 121.0498, radiusM: 150 };

/** ~1 m of latitude in degrees. */
const LAT_DEG_PER_M = 1 / 111_320;

describe('E2-S07 geofence evaluation', () => {
  it('zero distance at the exact site location', () => {
    expect(distanceMeters(SITE, SITE)).toBe(0);
    expect(evaluateGeofence(SITE, SITE).withinFence).toBe(true);
  });

  it('passes just inside the boundary radius', () => {
    const inside = { lat: SITE.lat + 149 * LAT_DEG_PER_M, lng: SITE.lng };
    const result = evaluateGeofence(inside, SITE);
    expect(result.withinFence).toBe(true);
    expect(result.distanceM).toBeGreaterThan(147);
    expect(result.distanceM).toBeLessThan(151);
  });

  it('fails just outside the boundary radius', () => {
    const outside = { lat: SITE.lat + 152 * LAT_DEG_PER_M, lng: SITE.lng };
    const result = evaluateGeofence(outside, SITE);
    expect(result.withinFence).toBe(false);
    expect(result.distanceM).toBeGreaterThan(150);
  });

  it('measures a known long distance sanely (BGC → Quezon City ≈ 12–13 km)', () => {
    const qc = { lat: 14.676, lng: 121.0437 };
    const d = distanceMeters(SITE, qc);
    expect(d).toBeGreaterThan(12_000);
    expect(d).toBeLessThan(15_000);
    expect(evaluateGeofence(qc, SITE).withinFence).toBe(false);
  });

  it('handles longitude differences near the equator-ish latitudes', () => {
    const east = { lat: SITE.lat, lng: SITE.lng + 0.01 };
    const d = distanceMeters(SITE, east);
    expect(d).toBeGreaterThan(1_000);
    expect(d).toBeLessThan(1_200);
  });
});
