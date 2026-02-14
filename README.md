# ScopeBlind Gateway

**Deploy in 2 minutes. See what bots are doing to your API.**

A Cloudflare Worker that sits in front of your API as a reverse proxy. Starts in **shadow mode** — measures bot traffic without blocking anything. When you're ready, flip to enforcement.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/tomjwxf/scopeblind-gateway.git
cd scopeblind-gateway
npm install

# 2. Edit wrangler.toml:
#    - ORIGIN_URL = "https://your-api.com"
#    - SCOPEBLIND_VERIFIER_URL = "https://api.scopeblind.com/v/YOUR_SLUG/verify"
#      (get your slug by scanning your endpoint at scopeblind.com)

# 3. Deploy
npx wrangler deploy
```

That's it. No API keys, no signup. Your gateway is live at `scopeblind-gateway.<your-account>.workers.dev`.

Point your clients to the gateway URL instead of your origin. All traffic flows through, and you get shadow mode telemetry immediately.

## What Shadow Mode Does

Shadow mode is the default. It **never blocks anything** — it just measures.

Every state-changing request (POST, PUT, DELETE, PATCH) is checked for a ScopeBlind proof header. The gateway logs what would happen in enforcement mode:

| Scenario | Shadow Mode | Enforce Mode |
|----------|-------------|--------------|
| No proof header | ✅ Forward + log `would-block` | ❌ 401 Rejected |
| Invalid proof | ✅ Forward + log `would-block` | ❌ 429 Rejected |
| Valid proof | ✅ Forward + log `verified` | ✅ Forward |
| Verifier down | ✅ Forward + log `fallback-allow` | Depends on `FALLBACK_MODE` |

GET requests always pass through — they're never checked.

## Reading Shadow Mode Logs

```bash
# Stream logs from your deployed worker
npx wrangler tail --format json | jq 'select(.logs[]?.message | contains("_scopeblind"))'
```

Every logged event includes:
- `action`: `no_proof`, `verify_failed`, `verified`, or `verifier_error`
- `method`: HTTP method (POST, PUT, etc.)
- `path`: Request path
- `ts`: ISO timestamp

After 7 days, you'll have real data showing exactly how much unverified traffic hits your API.

## Health Check

```bash
curl https://scopeblind-gateway.<you>.workers.dev/_scopeblind/health
```

Returns:
```json
{
  "ok": true,
  "mode": "shadow",
  "origin": "https://your-api.com",
  "verifier": "https://api.scopeblind.com/verify"
}
```

## Configuration

All config lives in `wrangler.toml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ORIGIN_URL` | (required) | Your backend API URL |
| `SCOPEBLIND_VERIFIER_URL` | (required) | Your tenant-specific verify URL (e.g. `https://api.scopeblind.com/v/abc123/verify`) |
| `SHADOW_MODE` | `"true"` | `"true"` = measure only, `"false"` = enforce |
| `PROTECTED_METHODS` | `"POST,PUT,DELETE,PATCH"` | Comma-separated HTTP methods to check |
| `FALLBACK_MODE` | `"open"` | `"open"` = allow if verifier down, `"closed"` = block |

No secrets needed — your tenant slug in the verifier URL identifies you.

## Switching to Enforcement

When your shadow mode data confirms the traffic patterns, flip to enforcement:

```toml
# wrangler.toml
SHADOW_MODE = "false"
```

```bash
npx wrangler deploy
```

Now requests without valid ScopeBlind proofs are blocked at the edge — before they hit your backend.

## How It Works

```
Client → Cloudflare Edge → [ScopeBlind Gateway] → Your API
                                    ↓
                           Verify proof with
                           api.scopeblind.com
```

1. Request arrives at the gateway worker
2. If the method is protected (POST/PUT/DELETE/PATCH), check for `X-Proof` or `X-ScopeBlind-Proof` header
3. Verify the proof with ScopeBlind's API
4. Forward to your origin with `X-ScopeBlind-*` metadata headers
5. Your origin can read these headers to see verification status

Headers forwarded to your origin:
- `X-ScopeBlind-Mode`: `shadow` or `enforce`
- `X-ScopeBlind-Verified`: `true`, `failed`, `missing`, `skipped`, or `error`
- `X-ScopeBlind-Action`: `would-block` (shadow mode only)
- `X-ScopeBlind-Remaining`: Remaining quota for this proof

## License

MIT
