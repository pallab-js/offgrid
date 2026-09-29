import type { WebSocket } from "ws";

export interface ConnDevice {
  id: string;
  name: string;
  color: string;
}

export interface Conn {
  id: string;
  ws: WebSocket;
  roomId: string | null;
  device: ConnDevice | null;
  lastFrameAt: number;
  /** sliding-window rate limiter */
  windowStart: number;
  windowCount: number;
  rttMs: number | null;
  battery: number | null;
}

const byRoom = new Map<string, Set<Conn>>();
const all = new Set<Conn>();

export function addConn(conn: Conn): void {
  all.add(conn);
}

export function removeConn(conn: Conn): void {
  all.delete(conn);
  if (conn.roomId) {
    const set = byRoom.get(conn.roomId);
    set?.delete(conn);
    if (set && set.size === 0) byRoom.delete(conn.roomId);
  }
}

export function enterRoom(conn: Conn, roomId: string): void {
  if (conn.roomId === roomId) return;
  if (conn.roomId) exitRoom(conn);
  conn.roomId = roomId;
  let set = byRoom.get(roomId);
  if (!set) {
    set = new Set();
    byRoom.set(roomId, set);
  }
  set.add(conn);
}

export function exitRoom(conn: Conn): void {
  if (!conn.roomId) return;
  const set = byRoom.get(conn.roomId);
  set?.delete(conn);
  if (set && set.size === 0) byRoom.delete(conn.roomId);
  conn.roomId = null;
  conn.device = null;
}

export function roomConns(roomId: string): Conn[] {
  return [...(byRoom.get(roomId) ?? [])];
}

export function roomConnectionCount(roomId: string): number {
  return byRoom.get(roomId)?.size ?? 0;
}

export function connectionCount(): number {
  return all.size;
}

export function allConns(): Conn[] {
  return [...all];
}

/** deviceId → live connection info (multiple tabs collapse to one peer). */
export function onlinePeers(roomId: string): Map<string, { rttMs: number | null }> {
  const map = new Map<string, { rttMs: number | null }>();
  for (const conn of roomConns(roomId)) {
    if (!conn.device) continue;
    const current = map.get(conn.device.id);
    if (!current || (conn.rttMs !== null && current.rttMs !== null && conn.rttMs < current.rttMs)) {
      map.set(conn.device.id, { rttMs: conn.rttMs ?? current?.rttMs ?? null });
    } else if (!current) {
      map.set(conn.device.id, { rttMs: conn.rttMs });
    }
  }
  return map;
}

/** Fan out one JSON frame to every connection in a room (serialized once). */
export function broadcast(roomId: string, frame: object, except?: string): void {
  const payload = JSON.stringify(frame);
  for (const conn of roomConns(roomId)) {
    if (conn.id === except) continue;
    if (conn.ws.readyState === 1 /* OPEN */) {
      try {
        conn.ws.send(payload);
      } catch {
        /* socket is dying; liveness sweep will clean it up */
      }
    }
  }
}

export function send(conn: Conn, frame: object): void {
  if (conn.ws.readyState !== 1) return;
  try {
    conn.ws.send(JSON.stringify(frame));
  } catch {
    /* ignore */
  }
}
