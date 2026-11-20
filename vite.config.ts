import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const ollamaTarget = process.env.VITE_OLLAMA_REMOTE_HOST || process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const sttTarget = process.env.VITE_STT_REMOTE_HOST || process.env.STT_HOST || "http://127.0.0.1:5000";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/api/ollama": {
          target: ollamaTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ollama/, ""),
        },
        "/api/stt": {
          target: sttTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/stt/, ""),
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
