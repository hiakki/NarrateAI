import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Allow tunnel origins in dev (Cloudflare, localtunnel) so _next/* and API work when using a public URL
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.loca.lt",
    "*.localtunnel.me",
  ],
};

export default nextConfig;
