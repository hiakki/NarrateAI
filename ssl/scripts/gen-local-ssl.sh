#!/usr/bin/env bash
# Generate TLS certs for local dev (app/chat subdomains).
# Prefers mkcert (trusted by OS); falls back to OpenSSL self-signed.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="${ROOT}/certs"
mkdir -p "${CERT_DIR}"

DOMAINS=(app.narrateai.online chat.narrateai.online)

if command -v mkcert >/dev/null 2>&1; then
  echo "Using mkcert (install root CA once: mkcert -install)"
  mkcert -cert-file "${CERT_DIR}/narrateai.pem" -key-file "${CERT_DIR}/narrateai-key.pem" \
    "${DOMAINS[@]}"
  echo "Wrote ${CERT_DIR}/narrateai.pem and narrateai-key.pem"
  exit 0
fi

echo "mkcert not found; generating self-signed cert with OpenSSL (browser will warn)."
CONF="${CERT_DIR}/openssl-san.cnf"
cat > "${CONF}" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = app.narrateai.online

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = app.narrateai.online
DNS.2 = chat.narrateai.online
DNS.3 = localhost
EOF

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "${CERT_DIR}/narrateai-key.pem" \
  -out "${CERT_DIR}/narrateai.pem" \
  -config "${CONF}" -extensions v3_req

rm -f "${CONF}"
echo "Wrote ${CERT_DIR}/narrateai.pem and narrateai-key.pem"
