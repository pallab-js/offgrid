export function buildJoinUrl(origin: string, roomId: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  return `${base}/join?room=${encodeURIComponent(roomId.trim())}`;
}
