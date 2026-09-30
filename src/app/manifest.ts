import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OffGrid — off-grid messaging & field tools",
    short_name: "OffGrid",
    description:
      "Real-time messaging, file sharing and survival tooling for teams beyond the reach of the internet.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
