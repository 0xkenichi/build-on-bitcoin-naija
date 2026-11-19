// Minimal .env loader (no dependency). Real environment variables win.
import { existsSync, readFileSync } from "node:fs";
export function loadEnv(file = ".env") {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return true;
}
