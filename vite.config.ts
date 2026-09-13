import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/comic-reader/",
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Comic Reader",
        short_name: "Comic Reader",
        description: "A private, offline reader for local CBZ libraries.",
        start_url: "/comic-reader/",
        scope: "/comic-reader/",
        id: "/comic-reader/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#000",
        theme_color: "#000",
        icons: [
          {
            src: "/comic-reader/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/comic-reader/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: true,
        globPatterns: ["**/*.{html,js,css,svg,png,ico}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^\/comic-reader\/(?:index\.html)?$/]
      }
    })
  ]
});
