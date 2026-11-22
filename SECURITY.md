# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/NPavii/codesys-mcp/security/advisories/new). Do not open a public issue for an exploitable finding before a fix and coordinated disclosure date have been agreed. Include the affected commit, transport, configuration, impact and a minimal reproduction that does not target real PLC equipment.

## Security model

- **stdio** is the preferred local transport. It inherits the permissions of the launching user and exposes the complete CODESYS automation toolset, including `codesys_eval`. Run it only for trusted MCP clients.
- **HTTP** requires `MCP_TOKEN` with at least 32 characters. Clients send `Authorization: Bearer <token>`.
- HTTP defaults to `127.0.0.1`, read-only CODESYS tools, no browser Origins and a local Host allowlist.
- `HTTP_ENABLE_WRITES`, `HTTP_ENABLE_BATCH` and `HTTP_ENABLE_EVAL` are independent, disabled-by-default options. Enabling writes does not enable batch or eval.
- Non-loopback HTTP requires `HTTP_ALLOWED_HOSTS`; use HTTPS at a trusted reverse proxy and an explicit `HTTP_ALLOWED_ORIGINS` if browser access is necessary.
- Warm-daemon tasks use a per-user queue by default. Keep its ACL restricted to the owning user and SYSTEM.
- Project passwords, device passwords, tokens and full request bodies must never be written to application logs.

## Release checks

Before publishing:

```bash
npm test
npm run build
npm run lint
npm audit
npm run pack:check
```

`pack:check` fails if runtime queues, snapshots, logs, local configuration, test artifacts or other machine-local files enter the npm tarball.
