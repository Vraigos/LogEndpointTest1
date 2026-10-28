export const LOG_FILE_HREF =
  "https://github.com/Vraigos/LogEndpoint/blob/main/issus.json";

export const LOG_REPO_LABEL = "Vraigos/LogEndpoint";

export const MAX_TEXT = 2000;

export type PublicMessage = {
  text: string;
  at: string | null;
};

export type PublicLog = {
  messages: PublicMessage[];
  count: number;
  href: string;
  error: string | null;
};
