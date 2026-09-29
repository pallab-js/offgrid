import type { NextConfig } from "next";

/**
 * LAN peers open the dev server from other devices; Next 15.2+ checks
 * origins in dev. Comma-separate origins, e.g.
 * ALLOWED_DEV_ORIGINS="http://192.168.1.20:3000"
 */
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};

export default nextConfig;
