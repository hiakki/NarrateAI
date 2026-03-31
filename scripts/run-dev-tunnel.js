#!/usr/bin/env node
/**
 * Run pnpm dev:all + tunnel (Cloudflare or localtunnel) in one process.
 * Env: TUNNEL_PROVIDER=cloudflare|localtunnel, TUNNEL_SUBDOMAIN (for localtunnel), PORT.
 */
const { spawn, execSync } = require("child_process");
const path = require("path");
const { PORT, PROVIDER, getTunnelCommand, getTunnelCommandString } = require("./tunnel-config");

const projectRoot = path.resolve(__dirname, "..");

if (PROVIDER === "cloudflare") {
  try {
    execSync("cloudflared --version", { stdio: "ignore" });
  } catch {
    console.error("[ERROR] cloudflared not found. Install it first:");
    console.error("  Windows: winget install Cloudflare.cloudflared");
    console.error("  macOS:   brew install cloudflare/cloudflare/cloudflared");
    console.error("  Or use localtunnel: set TUNNEL_PROVIDER=localtunnel in .env");
    process.exit(1);
  }
}

const tunnelCmd = getTunnelCommandString();
console.log("[INFO] Starting app + " + PROVIDER + " tunnel (PORT=" + PORT + "). Public URL will appear below.\n");
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
    tunnelCmd,
  ],
  { stdio: "inherit", shell: true, cwd: projectRoot }
);
child.on("error", (err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
