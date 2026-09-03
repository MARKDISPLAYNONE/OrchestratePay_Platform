#!/usr/bin/env bash
# Fullstack API smoke test against the live local backend.
# Usage (from repo root, backend running):  bash scripts/e2e-smoke.sh
set -u
ROOT="${ROOT:-http://localhost:3000}"
ADMIN_SECRET="${ADMIN_SECRET:-$(grep -E '^ADMIN_SECRET=' Tap2Pay/backend/.env 2>/dev/null | cut -d= -f2- | tr -d '\r"')}"
PASS=0; FAIL=0; TMP=$(mktemp)

j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const v='$1'.split('.').reduce((a,k)=>a==null?undefined:a[k],o);console.log(v===undefined?'':(typeof v==='object'?JSON.stringify(v):v))}catch(e){console.log('')}})"; }
hex32() { node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"; }
now() { node -e "console.log(Date.now())"; }

req() { # method path [json-body] [bearer] [extra-header]
  local m=$1 p=$2 d=${3:-} a=${4:-} h=${5:-}
  local args=(-s -o "$TMP" -w '%{http_code}' -X "$m" -H 'Content-Type: application/json')
  [ -n "$a" ] && args+=(-H "Authorization: Bearer $a")
  [ -n "$h" ] && args+=(-H "$h")
  [ -n "$d" ] && args+=(-d "$d")
  CODE=$(curl "${args[@]}" "$ROOT$p"); BODY=$(cat "$TMP")
}
check() { # label expected-codes-regex [note]
  if echo "$CODE" | grep -Eq "^($2)$"; then PASS=$((PASS+1)); echo "PASS  $1  [$CODE] ${3:-}"
  else FAIL=$((FAIL+1)); echo "FAIL  $1  [$CODE] $BODY"; fi
}

echo "=== 0. Health ==="
req GET /health;    check "health" 200
req GET /readiness; check "readiness" 200

echo "=== 1. Consumer signup (fresh account) ==="
E="smoke$(date +%s)@test.com"
req POST /api/v1/auth/consumer/register "{\"email\":\"$E\",\"password\":\"TestPass123\",\"phone\":\"254700$(date +%s | cut -c5-10)\"}"
check "consumer register $E" "200|201"
echo "      fields: token=$([ -n "$(echo "$BODY"|j token)" ] && echo yes || echo NO) refreshToken=$([ -n "$(echo "$BODY"|j refreshToken)" ] && echo yes || echo NO) phone=$(echo "$BODY"|j phone) displayName=$(echo "$BODY"|j displayName) expiresAt=$(echo "$BODY"|j expiresAt)"

echo "=== 2. Consumer login (consumer2) ==="
req POST /api/v1/auth/consumer/login '{"email":"consumer2@test.com","password":"TestPass123"}'
check "consumer login" 200
CT=$(echo "$BODY"|j token); CRT=$(echo "$BODY"|j refreshToken); CID=$(echo "$BODY"|j consumerId)
echo "      consumerId=$CID refreshToken=$([ -n "$CRT" ] && echo yes || echo NO)"

echo "=== 3. Consumer refresh (Bug #21) ==="
req POST /api/v1/auth/consumer/refresh "{\"refreshToken\":\"$CRT\"}"
check "consumer refresh" 200 "fields: $(echo "$BODY"|node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(Object.keys(JSON.parse(d)).join(','))}catch(e){console.log('')}})")"
NT=$(echo "$BODY"|j token); [ -n "$NT" ] && CT=$NT
CRT2=$(echo "$BODY"|j refreshToken)
req POST /api/v1/auth/consumer/refresh "{\"refreshToken\":\"$CRT\"}"
check "consumer refresh REUSED old token -> must be rejected" "401|403"

echo "=== 4. Consumer reads (Bug #14 regression) ==="
req GET /api/v1/consumers/me "" "$CT";                       check "consumers/me" 200
req GET "/api/v1/consumers/me/transactions?limit=5&offset=0" "" "$CT"; check "consumers/me/transactions" 200
req GET /api/v1/consumers/me/loyalty "" "$CT";               check "consumers/me/loyalty" 200
req GET /health;                                             check "health STILL ok after loyalty" 200
req POST /api/v1/consumers/qr-token "" "$CT"; check "consumers/qr-token" "200|201"; QRT=$(echo "$BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
req GET /api/v1/consumers/me "" "";                          check "consumers/me WITHOUT token -> 401" 401

echo "=== 5. Merchant login ==="
req POST /api/v1/auth/login '{"email":"merchant@test.com","password":"TestPass123","deviceId":"smoke-01"}'
check "merchant login" 200
MT=$(echo "$BODY"|j token); MRT=$(echo "$BODY"|j refreshToken); MID=$(echo "$BODY"|j merchantId)
echo "      merchantId=$MID approvalStatus=$(echo "$BODY"|j approvalStatus) nfcSigningKey=$(echo "$BODY"|j nfcSigningKey) refreshToken=$([ -n "$MRT" ] && echo yes || echo NO)"

echo "=== 6. Merchant refresh (#17f) ==="
req POST /api/v1/auth/refresh "{\"refreshToken\":\"$MRT\"}"
check "merchant refresh" 200 "fields: $(echo "$BODY"|node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(Object.keys(JSON.parse(d)).join(','))}catch(e){console.log('')}})")"
NT=$(echo "$BODY"|j token); [ -n "$NT" ] && MT=$NT

echo "=== 7. Merchant reads ==="
req GET /api/v1/merchants/me "" "$MT";                                   check "merchants/me" 200
req GET "/api/v1/transactions?limit=5" "" "$MT";                         check "transactions list" 200
req GET /api/v1/merchants/me/analytics/weekly "" "$MT";                  check "analytics/weekly" 200
req GET /api/v1/loyalty/programme "" "$MT";                              check "loyalty/programme" "200|404"

echo "=== 8. Payments (placeholder Daraja creds -> 502 is a PASS) ==="
req POST /api/v1/transactions "{\"merchantId\":\"$MID\",\"amountCents\":1000,\"source\":\"CONSUMER_QR\",\"consumerQrToken\":\"$QRT\",\"idempotencyKey\":\"$(hex32)\",\"timestamp\":$(now),\"currency\":\"KES\"}" "$MT"
check "POST /transactions (merchant scans consumer QR, CONSUMER_QR)" "201|502" "status=$(echo "$BODY"|j status)"
req POST /api/v1/transactions/merchant-hce-token "{\"amountCents\":1000}" "$MT"; check "merchant-hce-token (Present NFC, no consumerId yet)" 200
K=$(hex32)
req POST "/api/v1/consumers/pay/$MID" "{\"amountCents\":1000,\"idempotencyKey\":\"$K\",\"timestamp\":$(now),\"currency\":\"KES\"}" "$CT"
check "POST /consumers/pay/:merchantId" "201|502" "status=$(echo "$BODY"|j status)"
req POST "/api/v1/consumers/pay/$MID" "{\"amountCents\":1000,\"idempotencyKey\":\"$K\",\"timestamp\":$(now),\"currency\":\"KES\"}" "$CT"
check "same idempotencyKey again -> same result, no second charge" "200|201|409|502"
req GET /health; check "health STILL ok after payments" 200

echo "=== 9. Admin ==="
req GET /api/v1/admin/stats "" "" "X-Admin-Secret: $ADMIN_SECRET";     check "admin/stats" 200
req GET /api/v1/admin/pending "" "" "X-Admin-Secret: $ADMIN_SECRET";   check "admin/pending" 200
req GET /api/v1/admin/stats "" "" "X-Admin-Secret: wrong";             check "admin/stats wrong secret -> 401/403" "401|403"

echo
echo "=================  PASS=$PASS  FAIL=$FAIL  ================="
rm -f "$TMP"