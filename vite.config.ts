// ⚖️ SK Jurídico 1.7.1 (versão simplificada) — a TELA.
//   npm run tela   → abre em http://localhost:5173 (as chamadas /api vão para o servidor na 8080)
//   npm run build  → dist/public (servida pelo próprio servidor)
//   npm run index  → dist/index (UM arquivo index.html que abre sozinho: APK, PWA, Netlify, pen drive)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const raiz = import.meta.dirname;

export default defineConfig(async ({ mode }) => {
  const index = mode === "index";
  const extras: any[] = [];
  if (index) { const { viteSingleFile } = await import("vite-plugin-singlefile"); extras.push(viteSingleFile()); }
  return {
    base: index ? "./" : (process.env.BASE_PATH || "/"),
    plugins: [react(), tailwindcss(), ...extras],
    resolve: {
      alias: {
        "@": path.resolve(raiz, "client", "src"),
        "@shared": path.resolve(raiz, "shared"),
        "@assets": path.resolve(raiz, "client", "src", "assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(raiz, "client"),
    publicDir: path.resolve(raiz, "client", "public"),
    build: {
      outDir: path.resolve(raiz, "dist", index ? "index" : "public"),
      emptyOutDir: true,
      chunkSizeWarningLimit: 8000,
    },
    server: {
      port: Number(process.env.PORT_TELA || 5173),
      host: "0.0.0.0",
      allowedHosts: true,
      // com o servidor ligado (8080), as chamadas /api vão para ele; desligado, o 🧩 plano B responde
      proxy: { "/api": { target: process.env.API_URL || "http://127.0.0.1:8080", changeOrigin: true } },
    },
  };
});
