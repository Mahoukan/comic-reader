import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/comic-reader/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Comic Reader",
        short_name: "Comics",
        description: "A private, offline reader for local CBZ libraries.",
        start_url: "/comic-reader/",
        scope: "/comic-reader/",
        display: "standalone",
        background_color: "#101214",
        theme_color: "#101214",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,svg,png,ico}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html"
      }
    })
  ]
});
