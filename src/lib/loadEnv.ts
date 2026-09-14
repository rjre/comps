import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads .env into process.env for a script run directly (`tsx foo.ts` /
 * `npm run <script>`), which is how every "run by hand" command in the
 * README is invoked. Nothing else does this for a plain tsx process: the
 * systemd services get their env from `EnvironmentFile=` in the unit
 * file, and Next.js loads .env itself for `dev`/`build`/`start` — but a
 * standalone script has neither, so process.env is empty unless something
 * loads it. This is that something; import it first, before any other
 * import that reads process.env at module-load time.
 *
 * Existing process.env values always win, so this never overrides a real
 * environment (systemd's included — re-importing it there is a no-op).
 */
export function loadEnv(path = join(process.cwd(), ".env")): void {
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch {
    return;
  }

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
    if (quoted) value = quoted[1] ?? "";

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();
