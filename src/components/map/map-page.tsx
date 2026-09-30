"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Crosshair,
  Download,
  FileUp,
  LocateFixed,
  MapPin,
  Trash2,
  Upload,
} from "lucide-react";
import { useMapStore, type WaypointView } from "@/stores/map";
import { useSessionStore } from "@/stores/session";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { TextInput } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { saveBlob } from "@/lib/files/api";
import {
  formatCoord,
  formatDistance,
  fromGpx,
  fromWaypointJson,
  haversineMeters,
  latLngToPx,
  pxToLatLng,
  toGpx,
  toWaypointJson,
} from "@/lib/geo/geo";

const COLORS = ["#ff3d8b", "#3ddc84", "#57c7ff", "#ffd23f", "#c5b0f4"];

const CAL_INDICES = [0, 1] as const;

interface Pixel {
  x: number;
  y: number;
}

interface Size {
  w: number;
  h: number;
}

interface NaturalImage {
  blob: Blob;
  size: Size;
}

interface PtDraft {
  pixel: Pixel | null;
  lat: string;
  lng: string;
}

interface PtPair {
  p1: PtDraft;
  p2: PtDraft;
}

function emptyPt(): PtDraft {
  return { pixel: null, lat: "", lng: "" };
}

function hasCoords(
  wp: WaypointView,
): wp is WaypointView & { lat: number; lng: number } {
  return wp.lat !== null && wp.lng !== null;
}

function coordText(wp: WaypointView): string {
  if (wp.lat !== null && wp.lng !== null) {
    return formatCoord({ lat: wp.lat, lng: wp.lng });
  }
  if (wp.gx !== null && wp.gy !== null) return `grid ${wp.gx},${wp.gy}`;
  return "no position";
}

export function MapPage() {
  const hasRoom = useSessionStore((s) => Boolean(s.roomId));
  const waypoints = useMapStore((s) => s.waypoints);
  const image = useMapStore((s) => s.image);
  const calibration = useMapStore((s) => s.calibration);
  const hydrate = useMapStore((s) => s.hydrate);
  const saveWaypoint = useMapStore((s) => s.saveWaypoint);
  const removeWaypoint = useMapStore((s) => s.removeWaypoint);
  const setImage = useMapStore((s) => s.setImage);
  const setCalibration = useMapStore((s) => s.setCalibration);

  const [natural, setNatural] = useState<NaturalImage | null>(null);
  const [pending, setPending] = useState<Pixel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState("Waypoint");
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pts, setPts] = useState<PtPair>(() => ({ p1: emptyPt(), p2: emptyPt() }));
  const [armed, setArmed] = useState<(typeof CAL_INDICES)[number] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const imgUrl = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image],
  );

  useEffect(() => {
    if (!imgUrl) return;
    return () => URL.revokeObjectURL(imgUrl);
  }, [imgUrl]);

  if (!hasRoom) {
    return (
      <div className="flex max-w-[56ch] flex-col items-start gap-5">
        <Eyebrow className="text-ink">Phase 4</Eyebrow>
        <h1 className="text-display-lg">Offline map</h1>
        <p className="text-body-lg">
          Calibrate a local map image, drop waypoints and share coordinates
          with the room — no internet tiles. Join a room to open the map.
        </p>
        <Link
          href="/join"
          className="inline-flex min-h-[44px] items-center rounded-pill border border-hairline bg-canvas px-5 py-2 text-button font-medium text-ink hover:border-ink/40"
        >
          Set up a room
        </Link>
      </div>
    );
  }

  const sorted = [...waypoints].sort((a, b) => b.updatedAt - a.updatedAt);
  const naturalSize =
    natural && image && natural.blob === image ? natural.size : null;
  const firstWithCoords = sorted.find(hasCoords) ?? null;
  const firstPoint = firstWithCoords
    ? { lat: firstWithCoords.lat, lng: firstWithCoords.lng }
    : null;
  const nextColor = COLORS[waypoints.length % COLORS.length];
  const pendingCoord =
    pending && calibration ? pxToLatLng(calibration, pending.x, pending.y) : null;
  const labelValue = label.trim() || "Waypoint";

  const p1Lat = Number(pts.p1.lat);
  const p1Lng = Number(pts.p1.lng);
  const p2Lat = Number(pts.p2.lat);
  const p2Lng = Number(pts.p2.lng);
  const calReady =
    pts.p1.pixel !== null &&
    pts.p2.pixel !== null &&
    pts.p1.lat.trim() !== "" &&
    pts.p1.lng.trim() !== "" &&
    pts.p2.lat.trim() !== "" &&
    pts.p2.lng.trim() !== "" &&
    Number.isFinite(p1Lat) &&
    Number.isFinite(p1Lng) &&
    Number.isFinite(p2Lat) &&
    Number.isFinite(p2Lng) &&
    !(
      pts.p1.pixel.x === pts.p2.pixel.x && pts.p1.pixel.y === pts.p2.pixel.y
    ) &&
    !(p1Lat === p2Lat && p1Lng === p2Lng);

  function markerPosition(wp: WaypointView): Pixel | null {
    if (!naturalSize) return null;
    if (wp.gx !== null && wp.gy !== null) {
      return {
        x: (wp.gx / naturalSize.w) * 100,
        y: (wp.gy / naturalSize.h) * 100,
      };
    }
    if (calibration && wp.lat !== null && wp.lng !== null) {
      const px = latLngToPx(calibration, { lat: wp.lat, lng: wp.lng });
      if (!px) return null;
      return {
        x: (px.x / naturalSize.w) * 100,
        y: (px.y / naturalSize.h) * 100,
      };
    }
    return null;
  }

  function distanceFromFirst(wp: WaypointView): string | null {
    if (!firstWithCoords || !firstPoint) return null;
    if (wp.id === firstWithCoords.id) return null;
    if (wp.lat === null || wp.lng === null) return null;
    const meters = haversineMeters(firstPoint, { lat: wp.lat, lng: wp.lng });
    return `from first: ${formatDistance(meters)}`;
  }

  function onCanvasClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (!image || !naturalSize) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * naturalSize.w;
    const y = ((e.clientY - rect.top) / rect.height) * naturalSize.h;
    setPending({ x, y });
    setSelectedId(null);
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>): void {
    if (!image) return;
    const el = e.currentTarget;
    setNatural({
      blob: image,
      size: { w: el.naturalWidth, h: el.naturalHeight },
    });
  }

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setConfirmRemove(false);
    setPending(null);
    void setImage(file);
  }

  function removeImage(): void {
    setConfirmRemove(false);
    setPending(null);
    setSelectedId(null);
    setPts({ p1: emptyPt(), p2: emptyPt() });
    setArmed(null);
    void setImage(null);
    void setCalibration(null);
  }

  function copyPendingPixel(index: (typeof CAL_INDICES)[number]): void {
    if (!pending) return;
    const pixel = pending;
    setPts((prev) =>
      index === 0
        ? { ...prev, p1: { ...prev.p1, pixel } }
        : { ...prev, p2: { ...prev.p2, pixel } },
    );
    setArmed(null);
  }

  function setPtField(
    index: (typeof CAL_INDICES)[number],
    field: "lat" | "lng",
    value: string,
  ): void {
    setPts((prev) => {
      const target = index === 0 ? prev.p1 : prev.p2;
      const updated: PtDraft =
        field === "lat" ? { ...target, lat: value } : { ...target, lng: value };
      return index === 0
        ? { ...prev, p1: updated }
        : { ...prev, p2: updated };
    });
  }

  function saveCalibration(): void {
    const a = pts.p1;
    const b = pts.p2;
    if (!a.pixel || !b.pixel || !calReady) return;
    void setCalibration({
      p1: { x: a.pixel.x, y: a.pixel.y, lat: p1Lat, lng: p1Lng },
      p2: { x: b.pixel.x, y: b.pixel.y, lat: p2Lat, lng: p2Lng },
    });
    setArmed(null);
  }

  async function saveAtPending(): Promise<void> {
    if (!pending) return;
    setAddError(null);
    const geo = calibration ? pxToLatLng(calibration, pending.x, pending.y) : null;
    try {
      await saveWaypoint({
        label: labelValue,
        lat: geo ? geo.lat : null,
        lng: geo ? geo.lng : null,
        gx: pending.x,
        gy: pending.y,
        color: nextColor,
      });
      setPending(null);
    } catch {
      setAddError("Could not save the waypoint");
    }
  }

  function addWithGps(): void {
    setAddError(null);
    if (!("geolocation" in navigator)) {
      setAddError("GPS is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let gx: number | null = null;
        let gy: number | null = null;
        if (calibration) {
          const px = latLngToPx(calibration, { lat, lng });
          if (px) {
            gx = px.x;
            gy = px.y;
          }
        }
        saveWaypoint({ label: labelValue, lat, lng, gx, gy, color: nextColor }).catch(
          () => setAddError("Could not save the waypoint"),
        );
      },
      (err) => setAddError(err.message || "Could not get a GPS fix"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function exportList(): { label: string; lat: number; lng: number }[] {
    return sorted.flatMap((wp) =>
      hasCoords(wp) ? [{ label: wp.label, lat: wp.lat, lng: wp.lng }] : [],
    );
  }

  function exportJson(): void {
    saveBlob(
      new Blob([toWaypointJson(exportList())], { type: "application/json" }),
      "offgrid-waypoints.json",
    );
  }

  function exportGpx(): void {
    saveBlob(
      new Blob([toGpx(exportList())], { type: "application/gpx+xml" }),
      "offgrid-waypoints.gpx",
    );
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    setImported(null);
    void importWaypoints(file);
  }

  async function importWaypoints(file: File): Promise<void> {
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();
      const looksGpx =
        name.endsWith(".gpx") ||
        name.endsWith(".xml") ||
        text.trimStart().startsWith("<");
      const parsed = looksGpx ? fromGpx(text) : fromWaypointJson(text);
      let count = 0;
      for (const wp of parsed) {
        await saveWaypoint({
          lat: wp.lat,
          lng: wp.lng,
          gx: null,
          gy: null,
          label: wp.label,
          color: COLORS[count % COLORS.length],
        });
        count += 1;
      }
      setImported(count);
      setTimeout(() => setImported(null), 2000);
    } catch {
      setImportError("Could not read that file");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow className="text-ink">Map</Eyebrow>
        <h1 className="text-display-lg">Team map</h1>
        <p className="caption text-ink">
          Calibrate a local image — no internet tiles
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div
          className="relative aspect-[4/3] w-full cursor-crosshair overflow-hidden rounded-xl border border-hairline bg-block-navy"
          onClick={onCanvasClick}
        >
          {imgUrl ? (
            <img
              src={imgUrl}
              alt="Map image"
              className="absolute inset-0 h-full w-full"
              onLoad={onImageLoad}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-body text-inverse-ink">
                Upload a map image to begin
              </p>
            </div>
          )}

          {sorted.map((wp) => {
            const pos = markerPosition(wp);
            if (!pos) return null;
            return (
              <button
                key={wp.id}
                type="button"
                aria-label={wp.label}
                title={wp.label}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(wp.id);
                }}
                className={cn(
                  "absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas shadow",
                  selectedId === wp.id && "ring-2 ring-canvas",
                )}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  backgroundColor: wp.color,
                }}
              />
            );
          })}

          {pending ? (
            <div className="pointer-events-none absolute left-3 top-3 rounded-pill border border-hairline bg-canvas px-3 py-1">
              <span className="caption text-ink">
                Pending waypoint at {Math.round(pending.x)},
                {Math.round(pending.y)}
                {pendingCoord
                  ? ` · ${formatCoord(pendingCoord)}`
                  : " — use the sidebar to save"}
              </span>
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4">
            <h2 className="caption text-ink">Map image</h2>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              aria-label="Map image file"
              className="hidden"
              onChange={onImageFile}
            />
            {image ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  Replace
                </Button>
                {confirmRemove ? (
                  <>
                    <Button variant="magenta" size="sm" onClick={removeImage}>
                      Remove
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmRemove(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmRemove(true)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ) : (
              <Button onClick={() => imageInputRef.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
                Upload image
              </Button>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="caption text-ink">Calibration</h2>
              <Pill tone={calibration ? "success" : "outline"}>
                2-point calibration: {calibration ? "set" : "not set"}
              </Pill>
            </div>
            {calibration ? (
              <>
                <p className="text-body-sm">
                  {formatCoord({
                    lat: calibration.p1.lat,
                    lng: calibration.p1.lng,
                  })}{" "}
                  at pixel {Math.round(calibration.p1.x)},
                  {Math.round(calibration.p1.y)} →{" "}
                  {formatCoord({
                    lat: calibration.p2.lat,
                    lng: calibration.p2.lng,
                  })}{" "}
                  at pixel {Math.round(calibration.p2.x)},
                  {Math.round(calibration.p2.y)}
                </p>
                <p className="text-body-sm">
                  Click the map for a live coordinate preview in the pending
                  chip.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void setCalibration(null)}
                >
                  Clear calibration
                </Button>
              </>
            ) : (
              <>
                <p className="text-body-sm">
                  Click the map to pick a pixel, then enter its real
                  coordinates.
                </p>
                {CAL_INDICES.map((i) => {
                  const draft = i === 0 ? pts.p1 : pts.p2;
                  return (
                    <div
                      key={i}
                      className="flex flex-col gap-2 rounded-md border border-hairline p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="caption text-ink">
                          Point {i + 1}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setArmed(i)}
                        >
                          <Crosshair className="size-3.5" aria-hidden="true" />
                          Pick point {i + 1}
                        </Button>
                      </div>
                      <span className="caption text-ink">
                        pixel{" "}
                        {draft.pixel
                          ? `${Math.round(draft.pixel.x)},${Math.round(draft.pixel.y)}`
                          : "not picked"}
                      </span>
                      {armed === i && pending ? (
                        <Button
                          variant="magenta"
                          size="sm"
                          onClick={() => copyPendingPixel(i)}
                        >
                          Use pending pixel for point {i + 1}
                        </Button>
                      ) : null}
                      {armed === i && !pending ? (
                        <p className="text-body-sm">
                          Click the map to set the pixel.
                        </p>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="caption text-ink">lat</span>
                          <TextInput
                            type="number"
                            step="any"
                            value={draft.lat}
                            onChange={(e) =>
                              setPtField(i, "lat", e.target.value)
                            }
                            placeholder="Latitude"
                            aria-label={`Point ${i + 1} latitude`}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="caption text-ink">lng</span>
                          <TextInput
                            type="number"
                            step="any"
                            value={draft.lng}
                            onChange={(e) =>
                              setPtField(i, "lng", e.target.value)
                            }
                            placeholder="Longitude"
                            aria-label={`Point ${i + 1} longitude`}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
                <Button disabled={!calReady} onClick={saveCalibration}>
                  Save calibration
                </Button>
              </>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4">
            <h2 className="caption text-ink">Add waypoint</h2>
            <label className="flex flex-col gap-1">
              <span className="caption text-ink">Label</span>
              <TextInput
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Waypoint"
                aria-label="Waypoint label"
              />
            </label>
            <span className="flex items-center gap-2 caption text-ink">
              next color
              <span
                className="size-3 rounded-full border border-hairline"
                style={{ backgroundColor: nextColor }}
                aria-hidden="true"
              />
            </span>
            {pending ? (
              <Button onClick={() => void saveAtPending()}>
                <MapPin className="size-4" aria-hidden="true" />
                Save at pending pixel
              </Button>
            ) : (
              <p className="text-body-sm">
                Click the map to set a pending pixel.
              </p>
            )}
            <Button variant="secondary" onClick={addWithGps}>
              <LocateFixed className="size-4" aria-hidden="true" />
              Add with my GPS
            </Button>
            {addError ? <p className="text-body-sm">{addError}</p> : null}
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="caption text-ink">Waypoints</h2>
              <span className="caption text-ink">{sorted.length}</span>
            </div>
            {sorted.length === 0 ? (
              <p className="text-body-sm">
                No waypoints yet — click the map or use GPS.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sorted.map((wp) => {
                  const fromFirst = distanceFromFirst(wp);
                  return (
                    <li
                      key={wp.id}
                      className="flex items-start gap-3 rounded-md border border-hairline px-3 py-2"
                    >
                      <span
                        className="mt-1 size-3 shrink-0 rounded-full border border-hairline"
                        style={{ backgroundColor: wp.color }}
                        aria-hidden="true"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-body-sm font-medium">
                          {wp.label}
                        </span>
                        <span className="caption text-ink">{coordText(wp)}</span>
                        {fromFirst ? (
                          <span className="caption text-ink">{fromFirst}</span>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${wp.label}`}
                        onClick={() => void removeWaypoint(wp.id)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-4">
            <h2 className="caption text-ink">Import / Export</h2>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.gpx,.gpx.xml"
              aria-label="Waypoint file to import"
              className="hidden"
              onChange={onImportFile}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={exportJson}>
                <Download className="size-4" aria-hidden="true" />
                Export JSON
              </Button>
              <Button variant="secondary" size="sm" onClick={exportGpx}>
                <Download className="size-4" aria-hidden="true" />
                Export GPX
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => importInputRef.current?.click()}
              >
                <FileUp className="size-4" aria-hidden="true" />
                Import
              </Button>
            </div>
            {importError ? (
              <p className="text-body-sm">{importError}</p>
            ) : null}
            {imported !== null ? (
              <p className="caption text-ink">Imported {imported} waypoints</p>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
