#!/usr/bin/env node
/**
 * Run only the tunnel (Cloudflare or localtunnel). Use in a separate terminal
 * so it keeps running while you restart the app (pnpm dev:all).
 * Env: TUNNEL_PROVIDER=cloudflare|localtunnel, TUNNEL_SUBDOMAIN (for localtunnel), PORT.
 */
const { spawn } = require("child_process");
const { PORT, PROVIDER, SUBDOMAIN, getTunnelCommand } = require("./tunnel-config");

const { command, args, provider } = getTunnelCommand();

if (provider === "cloudflare") {
  try {
    require("child_process").execSync("cloudflared --version", { stdio: "ignore" });
  } catch {
    console.error("[Tunnel] cloudflared not found. Install: winget install Cloudflare.cloudflared");
    process.exit(1);
  }
}

console.log("[Tunnel] Starting " + provider + " (PORT=" + PORT + ")");
if (provider === "localtunnel" && SUBDOMAIN) console.log("[Tunnel] Subdomain: " + SUBDOMAIN);
console.log("[Tunnel] Set NEXT_PUBLIC_APP_URL and NEXTAUTH_URL to the URL below.\n");

const child = spawn(command, args, { stdio: "inherit", shell: true });
child.on("error", (err) => {
  console.error("[Tunnel] Failed:", err.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
