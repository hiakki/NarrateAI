/**
 * Tunnel provider config: cloudflare | localtunnel.
 * Used by run-tunnel-only.js and run-dev-tunnel.js.
 * Env: TUNNEL_PROVIDER, TUNNEL_SUBDOMAIN (for localtunnel), PORT.
 */
const path = require("path");

try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
} catch {}

const PORT = process.env.PORT || "3000";
const PROVIDER = (process.env.TUNNEL_PROVIDER || "cloudflare").toLowerCase();
const SUBDOMAIN = process.env.TUNNEL_SUBDOMAIN || "";

function getTunnelCommand() {
  if (PROVIDER === "localtunnel") {
    const args = ["--port", PORT];
    if (SUBDOMAIN) args.push("--subdomain", SUBDOMAIN.trim());
    return { command: "npx", args: ["localtunnel", ...args], provider: "localtunnel" };
  }
  // cloudflare (default)
  return {
    command: "cloudflared",
    args: ["tunnel", "--url", `http://localhost:${PORT}`],
    provider: "cloudflare",
  };
}

/** Full tunnel command string for use with concurrently (shell: true). */
function getTunnelCommandString() {
  const { command, args } = getTunnelCommand();
  return [command, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
}

module.exports = { PORT, PROVIDER, SUBDOMAIN, getTunnelCommand, getTunnelCommandString };
