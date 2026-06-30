import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "client",
  publicDir: resolve(__dirname, "public"),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "client/index.html"),
        solo: resolve(__dirname, "client/solo.html"),
        host: resolve(__dirname, "client/host.html"),
        tv: resolve(__dirname, "client/tv.html"),
        play: resolve(__dirname, "client/play.html"),
        gallery: resolve(__dirname, "client/gallery.html"),
      },
    },
  },
});
