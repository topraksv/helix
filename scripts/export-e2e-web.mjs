import { copyFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const output = "dist-e2e";
await rm(output, { recursive: true, force: true });

// `--clear` is load-bearing, not hygiene. Metro's transform cache key does not
// include EXPO_PUBLIC_* values, so without it this export reuses the previous
// production transforms and ships the real Supabase URL and anon key inside the
// local-only artifact. Measured both ways. The same cache is why every
// production bundle (`expo export`, `eas update`) must clear it too.
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["expo", "export", "-p", "web", "--clear", "--output-dir", output], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Use the product's real local-only path. No E2E-only auth bypass is
    // compiled into application code, and the production export runs first in
    // CI with its normal public Supabase values.
    EXPO_PUBLIC_SUPABASE_URL: "",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "",
    // Expo otherwise reloads the developer's .env after spawn and replaces
    // the intentional empty values with the linked production project.
    EXPO_NO_DOTENV: "1",
  },
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
if (exitCode !== 0) process.exit(exitCode);

// Direct links to dynamic routes must boot the client router exactly as Pages
// does in production.
await copyFile(`${output}/index.html`, `${output}/404.html`);
