#!/usr/bin/env node
/**
 * Run pnpm dev:all + Cloudflare tunnel in one process.
 * Loads .env for PORT (default 3000). Requires cloudflared on PATH.
 */
const { spawn, execSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
try {
  require("dotenv").config({ path: path.join(projectRoot, ".env") });
} catch {
  // dotenv optional
}
const PORT = process.env.PORT || "3000";

try {
  execSync("cloudflared --version", { stdio: "ignore" });
} catch {
  console.error("[ERROR] cloudflared not found. Install it first:");
  console.error("  Windows: winget install Cloudflare.cloudflared");
  console.error("  macOS:   brew install cloudflare/cloudflare/cloudflared");
  console.error("  Or run:  scripts/setup_prerequisites.bat or ./scripts/setup_prerequisites.sh");
  process.exit(1);
}

const tunnelUrl = `http://localhost:${PORT}`;
console.log("[INFO] Starting app + tunnel (PORT=" + PORT + "). Public URL will appear below.\n");
const child = spawn(
  "pnpm",
  [
    "exec",
    "concurrently",
    "-n",
    "dev,tunnel",
    "-c",
    "blue,magenta",
    "pnpm dev:all",
    `cloudflared tunnel --url ${tunnelUrl}`,
  ],
  { stdio: "inherit", shell: true, cwd: projectRoot }
);
child.on("error", (err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
