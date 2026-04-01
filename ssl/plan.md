# Local nginx for NarrateAI domains

## Quick setup (recommended)

From `contrib/nginx`:

```bash
./scripts/setup-local.sh
```

This installs nginx (Homebrew on macOS, apt/dnf/apk on Linux when available), optionally installs **mkcert** on macOS, runs `mkcert -install` when mkcert is present, creates temp dirs under this tree, runs `./scripts/gen-local-ssl.sh`, optionally appends `/etc/hosts`, and runs `nginx -t`. It then prints exact commands to start and stop nginx (binding to 80/443 usually needs `sudo`).

### Production certificates (Let's Encrypt)

Use the helper script to obtain publicly trusted certs once your DNS points to the server:

```bash
cd contrib/NarrateAI/ssl
sudo ./scripts/issue-letsencrypt.sh --email you@example.com
```

The script installs certbot (if missing), safely stops anything bound to port 80 (nginx, other proxies) so the HTTP challenge can run, requests a certificate for
`app.narrateai.online`, `chat.narrateai.online`, `narrateai.online`, and `www.narrateai.online`, and reports where the files are stored (`/etc/letsencrypt/live/<name>/`). Update `nginx.conf` to reference those paths and reload nginx. Run `sudo certbot renew --dry-run` to verify renewal. A cron/systemd timer is usually installed with certbot to automate renewal.

---

| Host | Upstream |
|------|----------|
| `app.narrateai.online` | `127.0.0.1:3000` (Next.js — listens on localhost only; nginx terminates TLS on 443) |
| `chat.narrateai.online` | `127.0.0.1:5173` (Vite) |

**Binding:** The app (`pnpm dev` / `pnpm start`) and Prisma Studio bind to **127.0.0.1** only. Docker Postgres/Redis publish to **127.0.0.1:5432** and **127.0.0.1:6379** so they are not exposed on the LAN.

## 1. `/etc/hosts`

```text
127.0.0.1 app.narrateai.online chat.narrateai.online
```

## 2. TLS (local)

From this directory:

```bash
./scripts/gen-local-ssl.sh
```

- **mkcert** (recommended): install with `brew install mkcert`, run `mkcert -install` once so browsers trust the CA.
- **OpenSSL** fallback: self-signed; browsers will show a warning unless you add an exception.

Certs are written to `certs/narrateai.pem` and `certs/narrateai-key.pem` (gitignored).

## 3. Run nginx

Paths in `nginx.conf` are relative to the **prefix** (`-p`), so run from this folder:

```bash
cd /path/to/contrib/nginx
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
nginx -p "$(pwd)" -c "$(pwd)/nginx.conf"
# foreground / debug:
# nginx -p "$(pwd)" -c "$(pwd)/nginx.conf" -g 'daemon off;'
```

Stop: `nginx -s quit` (if using default pid path, you may need `-p` and `-c` again) or `pkill -f nginx.conf` — for the sample config, PID file is `/tmp/nginx-narrateai.pid`.

## 4. Behaviour (redirects & rewrites)

- **Redirect:** HTTP **80** → HTTPS **301** for both hostnames (`$host` preserved).
- **Rewrite:** Add `rewrite` / `return` inside `server` or `location` blocks as needed, for example:

```nginx
# Permanent redirect one path to another on same host
# rewrite ^/old-path$ /new-path permanent;

# Or proxy-only path strip (example)
# location /api/ {
#     rewrite ^/api/(.*)$ /$1 break;
#     proxy_pass http://backend;
# }
```

- **Chat / Vite:** `Upgrade` and `Connection` headers are set so HMR WebSockets work through the proxy.

## 5. Files

| File | Role |
|------|------|
| `nginx.conf` | Main config: upstreams, SSL, HTTP→HTTPS, proxies |
| `mime.types` | Bundled MIME map (prefix-relative include) |
| `scripts/gen-local-ssl.sh` | mkcert or OpenSSL cert generation |
| `scripts/setup-local.sh` | Installs nginx + mkcert (where supported), certs, dirs, hosts, `nginx -t` |
| `.gitignore` | Ignores `certs/*.pem` and `logs/` |
