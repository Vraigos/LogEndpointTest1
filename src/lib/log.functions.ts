import { createServerFn } from "@tanstack/react-start";
import { LOG_FILE_HREF, type PublicLog } from "@/lib/log-public";

export const loadLog = createServerFn({ method: "GET" }).handler(async (): Promise<PublicLog> => {
  const { publicErrorMessage, readLog } = await import("./github-log.server");
  try {
    return await readLog();
  } catch (err) {
    return {
      messages: [],
      count: 0,
      href: LOG_FILE_HREF,
      error: publicErrorMessage(err),
    };
  }
});
