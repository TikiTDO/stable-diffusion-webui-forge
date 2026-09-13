import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const forge = env.VITE_FORGE_TARGET || "http://127.0.0.1:7865";

  return {
    base: "/diffusatory/",
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/sdapi": forge,
        "/internal": forge,
        "/controlnet": forge,
        "/diffusatory/api": forge,
      },
    },
    test: {
      environment: "node",
    },
  };
});
