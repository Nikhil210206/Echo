import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { host: true, port: 5180 },
  // Pre-bundle every GSAP entry together. If Vite discovers one later it
  // re-optimizes mid-session and the page ends up with two GSAP copies,
  // which freezes tweens halfway.
  optimizeDeps: {
    include: ["gsap", "gsap/ScrollTrigger", "gsap/SplitText", "gsap/CustomEase", "@gsap/react", "recharts", "qrcode.react"],
  },
});
