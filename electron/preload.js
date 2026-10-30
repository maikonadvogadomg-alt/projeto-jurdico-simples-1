/**
 * SK Jurídico — Preload Electron
 * Expõe APIs seguras para o renderer via contextBridge
 */

const { contextBridge, ipcRenderer, shell } = require("electron");
const path = require("path");
const os = require("os");

contextBridge.exposeInMainWorld("skDesktop", {
  // Info do ambiente
  platform: process.platform,
  version: process.env.npm_package_version || "1.5.0",
  isDesktop: true,
  isElectron: true,
  homeDir: os.homedir(),

  // API base URL — aponta para o backend local
  apiBaseUrl: "http://localhost:8080",

  // Abre URL no browser padrão
  openExternal: (url) => shell.openExternal(url),

  // Info de sistema
  getSystemInfo: () => ({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    memory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    hostname: os.hostname(),
  }),
});

// Intercepta todas as chamadas /api/* para redirecionar ao backend local
window.addEventListener("DOMContentLoaded", () => {
  const API_URL = "http://localhost:8080";

  // Sobrescreve fetch para redirecionar /api/* ao backend local
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url && url.startsWith("/api/")) {
      url = `${API_URL}${url}`;
      if (typeof input === "string") {
        input = url;
      } else if (input instanceof URL) {
        input = new URL(url);
      } else {
        input = new Request(url, input);
      }
    }

    return originalFetch.call(this, input, init);
  };

  console.log("[SK Desktop] Preload carregado — API interceptada para localhost:8080");
});
