# Changelog

## v0.3.1 (2026-03-24)

### Added
- Per-tool policies: `block`, `rate_limit`, `min_tier`, `require_approval`
- Non-blocking approval flow with request_id scoping and nonce authentication
- Passport identity in `protect-mcp status` output
- Signed decision receipts persisted to `.protect-mcp-receipts.jsonl`
- Audit bundle export via `protect-mcp bundle`
- `protect-mcp simulate` — dry-run policy evaluation against recorded tool calls
- `protect-mcp report` — compliance report generation (JSON + Markdown)
- Policy packs: shadow, web-browsing-safe, email-safe, strict
- Local HTTP status server with receipt API and approval endpoints

### Changed
- Shadow mode is the default (renamed from "observe mode")
- Decision logs use v2 format with tier and reason codes

## v0.3.0 (2026-03-22)

### Added
- Trust-tier gating from agent manifests
- Credential vault configuration
- BYOPE hooks (OPA, Cerbos, generic HTTP)
- `protect-mcp init` — generates Ed25519 signing keys and config template

## v0.2.0 (2026-03-21)

### Added
- Artifact v2 envelope format with JCS canonicalization
- JWK thumbprint-based key identifiers (kid)
- Holder binding commitments

## v0.1.0 (2026-03-08)

### Added
- Initial release: stdio proxy, shadow/enforce modes, per-tool policies, structured decision logs
