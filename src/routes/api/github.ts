import { createFileRoute } from "@tanstack/react-router";
import { handleGet, handleLocked, handleOptions, handlePost } from "@/lib/log-http.server";

export const Route = createFileRoute("/api/github")({
  server: {
    handlers: {
      OPTIONS: async () => handleOptions(),
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
      PUT: async () => handleLocked(),
      PATCH: async () => handleLocked(),
      DELETE: async () => handleLocked(),
    },
  },
});
