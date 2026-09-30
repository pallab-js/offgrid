"use client";

import { create } from "zustand";
import type { Waypoint } from "@/lib/protocol";
import type { GeoPoint } from "@/lib/geo/geo";
import { ulid } from "@/lib/utils/id";
import { sealText, openText } from "@/lib/crypto/keycache";
import { enqueue } from "@/lib/sync/outbox";
import { getDb, type Calibration, type WaypointRecord } from "@/lib/idb/db";
import { useSessionStore } from "./session";

export interface WaypointView {
  id: string;
  lat: number | null;
  lng: number | null;
  gx: number | null;
  gy: number | null;
  label: string;
  color: string;
  updatedAt: number;
  updatedBy: string;
  deletedAt: number | null;
  rev: number;
}

interface MapState {
  waypoints: WaypointView[];
  loaded: boolean;
  image: Blob | null;
  calibration: Calibration | null;
  route: GeoPoint[];

  hydrate: () => Promise<void>;
  saveWaypoint: (input: {
    id?: string;
    lat: number | null;
    lng: number | null;
    gx: number | null;
    gy: number | null;
    label: string;
    color: string;
  }) => Promise<string>;
  removeWaypoint: (id: string) => Promise<void>;
  applyUpsert: (waypoint: Waypoint, rev: number) => Promise<void>;
  applyDelete: (id: string, rev: number) => Promise<void>;
  setImage: (image: Blob | null) => Promise<void>;
  setCalibration: (calibration: Calibration | null) => Promise<void>;
  setRoute: (route: GeoPoint[] | null) => Promise<void>;
  reset: () => void;
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function toView(record: WaypointRecord): Promise<WaypointView> {
  return {
    id: record.id,
    lat: record.lat,
    lng: record.lng,
    gx: record.gx,
    gy: record.gy,
    label: (await openText(record.label)) ?? "",
    color: record.color,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    deletedAt: record.deletedAt,
    rev: record.rev,
  };
}

function sortWaypoints(list: WaypointView[]): WaypointView[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useMapStore = create<MapState>((set, get) => ({
  waypoints: [],
  loaded: false,
  image: null,
  calibration: null,
  route: [],

  hydrate: () =>
    serialized(async () => {
      if (get().loaded) return;
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const rows = await db.getAllFromIndex("waypoints", "by-room", roomId);
      const records = rows.filter(
        (r) => r.roomId === roomId && r.deletedAt === null,
      );
      const views = await Promise.all(records.map(toView));
      const meta = await db.get("meta", "map");
      set({
        waypoints: sortWaypoints(views),
        image: meta?.image ?? null,
        calibration: meta?.calibration ?? null,
        route: meta?.route ?? [],
        loaded: true,
      });
    }),

  saveWaypoint: (input) =>
    serialized(async () => {
      const { roomId, deviceId } = useSessionStore.getState();
      if (!roomId || !deviceId) throw new Error("no session");
      const id = input.id ?? ulid();
      const label = await sealText(input.label);
      const updatedAt = Date.now();
      const db = await getDb();
      const existing = await db.get("waypoints", id);
      const record: WaypointRecord = {
        id,
        roomId,
        lat: input.lat,
        lng: input.lng,
        gx: input.gx,
        gy: input.gy,
        label,
        color: input.color,
        updatedAt,
        updatedBy: deviceId,
        deletedAt: null,
        rev: existing?.rev ?? 0,
      };
      await db.put("waypoints", record);
      const view = await toView(record);
      set((state) => ({
        waypoints: sortWaypoints([view, ...state.waypoints.filter((w) => w.id !== id)]),
      }));
      await enqueue({
        t: "wp.save",
        clientId: ulid(),
        id,
        lat: input.lat,
        lng: input.lng,
        gx: input.gx,
        gy: input.gy,
        label,
        color: input.color,
        updatedAt,
      });
      return id;
    }),

  removeWaypoint: (id) =>
    serialized(async () => {
      const updatedAt = Date.now();
      const db = await getDb();
      const existing = await db.get("waypoints", id);
      if (existing) {
        await db.put("waypoints", { ...existing, deletedAt: updatedAt });
      }
      set((state) => ({
        waypoints: state.waypoints.filter((w) => w.id !== id),
      }));
      await enqueue({ t: "wp.del", clientId: ulid(), id, updatedAt });
    }),

  applyUpsert: (waypoint, rev) =>
    serialized(async () => {
      const { roomId } = useSessionStore.getState();
      if (!roomId) return;
      const db = await getDb();
      const existing = await db.get("waypoints", waypoint.id);
      if (existing && existing.rev > rev) return;
      const record: WaypointRecord = {
        id: waypoint.id,
        roomId,
        lat: waypoint.lat,
        lng: waypoint.lng,
        gx: waypoint.gx,
        gy: waypoint.gy,
        label: waypoint.label,
        color: waypoint.color,
        updatedAt: waypoint.updatedAt,
        updatedBy: waypoint.updatedBy,
        deletedAt: waypoint.deletedAt,
        rev,
      };
      await db.put("waypoints", record);
      if (record.deletedAt !== null) {
        set((state) => ({
          waypoints: state.waypoints.filter((w) => w.id !== waypoint.id),
        }));
        return;
      }
      const view = await toView(record);
      set((state) => ({
        waypoints: sortWaypoints([
          view,
          ...state.waypoints.filter((w) => w.id !== waypoint.id),
        ]),
      }));
    }),

  applyDelete: (id, rev) =>
    serialized(async () => {
      const db = await getDb();
      const existing = await db.get("waypoints", id);
      if (existing && existing.rev > rev) return;
      if (existing) {
        await db.put("waypoints", {
          ...existing,
          deletedAt: Date.now(),
          rev,
        });
      }
      set((state) => ({ waypoints: state.waypoints.filter((w) => w.id !== id) }));
    }),

  setImage: (image) =>
    serialized(async () => {
      const db = await getDb();
      const meta = (await db.get("meta", "map")) ?? { key: "map" };
      await db.put("meta", { ...meta, key: "map", image });
      set({ image });
    }),

  setCalibration: (calibration) =>
    serialized(async () => {
      const db = await getDb();
      const meta = (await db.get("meta", "map")) ?? { key: "map" };
      await db.put("meta", { ...meta, key: "map", calibration });
      set({ calibration });
    }),

  setRoute: (route) =>
    serialized(async () => {
      const db = await getDb();
      const meta = (await db.get("meta", "map")) ?? { key: "map" };
      await db.put("meta", { ...meta, key: "map", route });
      set({ route: route ?? [] });
    }),

  reset: () =>
    set({
      waypoints: [],
      loaded: false,
      image: null,
      calibration: null,
      route: [],
    }),
}));
