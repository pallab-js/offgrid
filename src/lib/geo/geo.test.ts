import { describe, expect, it } from "vitest";
import {
  bounds,
  escapeXml,
  formatCoord,
  formatDistance,
  fromGpx,
  fromWaypointJson,
  haversineMeters,
  latLngToPx,
  pxToLatLng,
  toGpx,
  toWaypointJson,
} from "./geo";

const calibration = {
  p1: { x: 0, y: 0, lat: 12.9, lng: 77.5 },
  p2: { x: 1000, y: 800, lat: 12.8, lng: 77.7 },
};

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBe(0);
  });

  it("matches a known ~111 km degree of latitude", () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_500);
  });
});

describe("format helpers", () => {
  it("formats meters under 1 km", () => {
    expect(formatDistance(854)).toBe("854 m");
  });

  it("formats kilometers with one decimal", () => {
    expect(formatDistance(3210)).toBe("3.2 km");
  });

  it("formats coordinates to 5 decimals", () => {
    expect(formatCoord({ lat: 12.9716, lng: 77.5946 })).toBe("12.97160, 77.59460");
  });
});

describe("calibration projection", () => {
  it("round-trips pixel → lat/lng → pixel", () => {
    const point = pxToLatLng(calibration, 400, 250);
    expect(point).not.toBeNull();
    const back = latLngToPx(calibration, point!);
    expect(back!.x).toBeCloseTo(400, 6);
    expect(back!.y).toBeCloseTo(250, 6);
  });

  it("anchors the control points exactly", () => {
    const p = pxToLatLng(calibration, 0, 0)!;
    expect(p.lat).toBeCloseTo(12.9, 9);
    expect(p.lng).toBeCloseTo(77.5, 9);
    const q = pxToLatLng(calibration, 1000, 800)!;
    expect(q.lat).toBeCloseTo(12.8, 9);
    expect(q.lng).toBeCloseTo(77.7, 9);
  });

  it("returns null for degenerate calibration", () => {
    expect(pxToLatLng({ p1: calibration.p1, p2: { ...calibration.p2, x: 0 } }, 1, 1)).toBeNull();
  });
});

describe("bounds", () => {
  it("returns null for empty input", () => {
    expect(bounds([])).toBeNull();
  });

  it("computes min/max across points", () => {
    const b = bounds([
      { lat: 12, lng: 77 },
      { lat: 13, lng: 78 },
      { lat: 11, lng: 76 },
    ]);
    expect(b).toEqual({ minLat: 11, maxLat: 13, minLng: 76, maxLng: 78 });
  });
});

describe("GPX", () => {
  const waypoints = [
    { label: "Rally point A", lat: 12.9716, lng: 77.5946 },
    { label: "Well <north>", lat: 12.8, lng: 77.7 },
  ];

  it("round-trips waypoints through GPX", () => {
    const xml = toGpx(waypoints);
    const parsed = fromGpx(xml);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.label).toBe("Rally point A");
    expect(parsed[0]!.lat).toBeCloseTo(12.9716, 6);
    expect(parsed[1]!.label).toBe("Well <north>");
  });

  it("escapes XML special characters", () => {
    expect(escapeXml('a & b <c> "d"')).toBe("a &amp; b &lt;c&gt; &quot;d&quot;");
  });

  it("parses lon-before-lat attributes", () => {
    const xml =
      '<wpt lon="77.6" lat="12.9"><name>Alt</name></wpt>';
    const parsed = fromGpx(xml);
    expect(parsed).toEqual([{ label: "Alt", lat: 12.9, lng: 77.6 }]);
  });

  it("labels unnamed waypoints", () => {
    const parsed = fromGpx('<wpt lat="1" lon="2"></wpt>');
    expect(parsed[0]!.label).toBe("Waypoint 1");
  });
});

describe("JSON export", () => {
  it("round-trips waypoints", () => {
    const waypoints = [{ label: "Camp", lat: 11.1, lng: 76.9 }];
    const parsed = fromWaypointJson(toWaypointJson(waypoints));
    expect(parsed).toEqual(waypoints);
  });

  it("rejects foreign JSON", () => {
    expect(() => fromWaypointJson('{"format":"other"}')).toThrow();
  });

  it("drops malformed entries", () => {
    const parsed = fromWaypointJson(
      JSON.stringify({ format: "offgrid-map", version: 1, waypoints: [{ lat: "x" }, { lat: 1, lng: 2 }] }),
    );
    expect(parsed).toEqual([{ label: "Waypoint", lat: 1, lng: 2 }]);
  });
});
