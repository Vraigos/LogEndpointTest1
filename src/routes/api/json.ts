import { createFileRoute } from "@tanstack/react-router";
import { handleGet, handleLocked, handleOptions, handlePostJson } from "@/lib/log-http.server";

export const Route = createFileRoute("/api/json")({
  server: {
    handlers: {
      OPTIONS: async () => handleOptions(),
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePostJson(request),
      PUT: async () => handleLocked(),
      PATCH: async () => handleLocked(),
      DELETE: async () => handleLocked(),
    },
  },
});
