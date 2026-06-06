#!/usr/bin/env bash
# extract-tls-pin.sh — Extract SHA-256 SPKI pin from a live TLS endpoint.
#
# Usage:
#   ./scripts/extract-tls-pin.sh api.orchestratepay.co.ke 443
#   ./scripts/extract-tls-pin.sh api.orchestratepay.co.ke        # port defaults to 443
#
# Output: Base64-encoded SHA-256 digest of SubjectPublicKeyInfo (DER)
# This is the exact format expected by Android's network_security_config.xml pin-set.
#
# Run before every TLS certificate renewal to update the network_security_config.xml
# files before shipping a release APK.
#
# Requirements: openssl (standard on macOS and Ubuntu)
#
# After updating the pin:
#   1. Replace the PRIMARY pin in:
#      - android/app/src/main/res/xml/network_security_config.xml
#      - android/consumer-wallet/src/main/res/xml/network_security_config.xml
#   2. Set expiration to 90 days before your cert expiry date
#   3. Test on a physical device in release build before shipping
set -euo pipefail

HOST="${1:-api.orchestratepay.co.ke}"
PORT="${2:-443}"

echo "Extracting TLS pin for ${HOST}:${PORT} ..."
echo ""

PIN=$(echo -n \
  | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | base64)

echo "SHA-256 SPKI pin:"
echo "  <pin digest=\"SHA-256\">${PIN}</pin>"
echo ""
echo "Add this as the PRIMARY pin in network_security_config.xml"
echo "Keep the existing pin as the BACKUP (rotation overlap)."
echo ""

# Also extract the full cert chain for reference
echo "--- Certificate chain (for reference) ---"
echo -n | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" -showcerts 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null \
  || echo "(Could not retrieve certificate chain — is the host reachable?)"
