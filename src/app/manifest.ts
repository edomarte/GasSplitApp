import type { MetadataRoute } from "next";

/**
 * Makes the app installable.
 *
 * The whole point of a web app here is that it works on a phone at a pump
 * without an app store, so "Add to Home Screen" needs to produce something that
 * looks and launches like an app: `standalone` drops the browser chrome, and
 * the maskable icon stops Android cropping the mark into a square badge.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gas Split",
    short_name: "Gas Split",
    description:
      "Log the kilometres you drive in a shared car and split each fuel fill proportionally.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a0a0a",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
