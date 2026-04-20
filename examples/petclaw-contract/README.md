# PetClaw Contract Samples

This folder contains machine-readable sample payloads for the current
`launcher + gateway + pet` integration flow.

Use these files for:

- frontend mocking
- websocket parser tests
- SDK integration tests
- program-to-program contract review

Recommended read order:

1. `manifest.json`
2. `launcher-*.json`
3. `gateway-*.json`
4. `ws-*.json`

Notes:

- `launcher` samples target `http://127.0.0.1:18800`
- `gateway` samples target the real gateway port, which may drift from `18790`
- `ws_url` must always be treated as runtime data rather than hardcoded

