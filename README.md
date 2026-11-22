<div align="center">

# CODESYS MCP

**CODESYS V3 automation through MCP: project editing, Structured Text refactoring, PLC operations, and searchable engineering documentation.**

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CODESYS V3](https://img.shields.io/badge/CODESYS-V3-C51A2E)](https://www.codesys.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Quick start](#quick-start) · [Capabilities](#highlights) · [Architecture](#architecture) · [Security](#security) · [Configuration](#configuration) · [Development](#development-and-verification)

</div>

A Model Context Protocol server for CODESYS Development System V3. It combines project and PLC automation through the CODESYS ScriptEngine with searchable, curated engineering documentation.

The server supports local **stdio** integration and an authenticated **Streamable HTTP** endpoint. HTTP is read-only for CODESYS operations by default.

## Highlights

- Create and inspect POUs, interfaces, DUTs, GVLs, methods, properties and actions.
- Edit Structured Text, build applications and manage project libraries.
- Work with devices, tasks, PLCopenXML, symbol configuration and network variable lists.
- Read, write, force and monitor online values; manage the application lifecycle where explicitly enabled.
- Search curated CODESYS guidance, local PDF manuals and allowlisted official documentation.
- Use snapshots, dry runs and project-wide reference analysis before risky changes.
- Run a warm CODESYS daemon for low-latency operations or an isolated cold process per call.

## Requirements

- Node.js 20 or newer.
- npm.
- Windows and CODESYS Development System V3 with ScriptEngine for project or PLC automation.
- Documentation tools do not require a CODESYS installation.

## Installation

```bash
git clone https://github.com/NPavii/codesys-mcp.git
cd codesys-mcp
npm install
npm run build
```

For agent-guided installation and client registration, see [`agent.md`](agent.md).

## Quick start

### Stdio — recommended for local agents

```bash
npm run start:stdio
```

Or register the built entry point directly:

```bash
node dist/src/cli.js --stdio
```

Stdio does not require an HTTP token. It exposes the complete trusted-local toolset, including `codesys_eval`, and inherits the launching user's permissions.

### HTTP

Generate a token and place it in `.env`:

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

```dotenv
MCP_TOKEN=<generated-token>
```

Start the server:

```bash
npm start
```

The default endpoint is:

```text
http://127.0.0.1:3000/mcp
```

Clients must send:

```text
Authorization: Bearer <MCP_TOKEN>
```

HTTP defaults to loopback only, denies browser Origins and exposes only read-only CODESYS tools. See [`SECURITY.md`](SECURITY.md) before enabling network access or write operations.

## Architecture

```text
MCP client
   │
   ├── stdio
   │
   └── authenticated HTTP
           │
           ▼
   Transport and tool policy
           │
           ▼
      Node.js bridge
           │
           ├── cold CODESYS process per operation
           │
           └── warm daemon with a per-user task queue
                       │
                       ▼
             CODESYS ScriptEngine
                       │
             .project / .library / PLC
```

The warm daemon keeps the ScriptEngine session open and reduces typical operation latency from tens of seconds to a few seconds. Exactly one daemon should serve one isolated bridge runtime.

Multiple agents working on different projects should use separate MCP processes and isolated bridge runtimes. They must not share a daemon, queue, ping file, project file or online PLC session.

## Tool catalogue

| Area | Representative tools |
|---|---|
| Project inspection | `codesys_project_open`, `codesys_project_info`, `codesys_list_objects`, `codesys_get_object`, `codesys_dump_pou_code` |
| Project editing | `codesys_create_pou`, `codesys_create_member`, `codesys_create_interface`, `codesys_create_dut`, `codesys_create_gvl`, `codesys_set_code` |
| Refactoring | `codesys_find_references`, `codesys_rename_object`, `codesys_rename_symbol`, `codesys_move_object` |
| Build and lifecycle | `codesys_build`, `codesys_application_build_action`, `codesys_clean_all`, `codesys_save_project`, `codesys_save_project_as` |
| Libraries | `codesys_lib_install`, `codesys_lib_add`, `codesys_lib_remove`, `codesys_lib_list`, `codesys_validate_library` |
| Tasks and devices | `codesys_list_tasks`, `codesys_configure_task`, `codesys_add_device`, `codesys_device_info`, `codesys_set_device_parameter` |
| Data exchange | `codesys_export_plcopen_xml`, `codesys_import_plcopen_xml`, `codesys_native_export`, `codesys_native_import`, `codesys_io_mappings_csv` |
| Online operations | `codesys_online_login`, `codesys_online_read`, `codesys_online_write`, `codesys_online_force`, `codesys_monitor_variables` |
| PLC application | `codesys_download_application`, `codesys_application_start_stop`, `codesys_application_reset`, `codesys_boot_application_create` |
| PLC files and source | `codesys_plc_file_list`, `codesys_plc_file_transfer`, `codesys_plc_file_delete`, `codesys_source_download`, `codesys_source_upload` |
| Symbols and NVL | `codesys_symbol_config_create`, `codesys_symbol_config_set_access`, `codesys_nvl_sender_set`, `codesys_nvl_receiver_create` |
| Safety and recovery | `codesys_snapshot`, `codesys_snapshot_list`, `codesys_snapshot_restore`, `codesys_online_change_check` |
| Documentation | `search_codesys_docs`, `get_codesys_topic`, `codesys_writing_guidance`, `list_codesys_pdfs`, `search_codesys_pdfs`, `get_codesys_pdf` |
| Official online help | `get_codesys_page`, `crawl_codesys_help` |

Destructive operations that accept `confirm` require an explicit `confirm: true`. This field is an operational safeguard, not a replacement for authentication or authorization.

## Recommended project workflow

1. Inspect the project tree and read existing objects before editing.
2. Keep the target project closed in the CODESYS GUI while the bridge owns it.
3. Create a snapshot before risky changes.
4. Use `codesys_batch` for related edits; use dry-run mode when available.
5. Run builds as standalone operations, not inside a batch.
6. Treat the compiler summary as the build verdict and resolve errors and warnings.
7. Close the project or stop the warm daemon before returning to manual GUI work.

## Warm daemon

Start the configured launcher:

```text
bridge/bridge_daemon.cmd
```

Useful environment switches:

| Variable | Purpose |
|---|---|
| `CB_MONITOR=0` | Do not open the companion monitor window. |
| `CB_KEEP=1` | Do not terminate existing CODESYS processes before startup. |
| `CB_QUEUE_DIR` | Override the per-user warm-daemon queue. Keep its ACL private. |
| `CB_WARM_PROJECTS` | Semicolon-separated project list for warm-up. |
| `CODESYS_BRIDGE_AUTOSTART=0` | Disable daemon auto-start from MCP. |

Machine-specific paths belong in `bridge/bridge_daemon.local.ps1`, which is excluded from Git and npm packages.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Bind host. Non-loopback requires `HTTP_ALLOWED_HOSTS`. |
| `MCP_TOKEN` | empty | Required for HTTP; minimum 32 characters. |
| `HTTP_ALLOWED_HOSTS` | local hosts | Comma-separated exact Host allowlist. |
| `HTTP_ALLOWED_ORIGINS` | empty | Exact browser Origin allowlist; empty denies browser calls. |
| `HTTP_ENABLE_WRITES` | `false` | Enables CODESYS writes and online control over HTTP. |
| `HTTP_ENABLE_EVAL` | `false` | Independently enables ScriptEngine eval over HTTP. |
| `HTTP_ENABLE_BATCH` | `false` | Enables batch; nested batch and disallowed operations remain blocked. |
| `HTTP_MAX_SESSIONS` | `16` | Maximum simultaneous MCP sessions. |
| `HTTP_SESSION_TTL_SECONDS` | `1800` | Idle session lifetime. |
| `HTTP_RATE_LIMIT_PER_MINUTE` | `120` | Per-source HTTP request limit. |
| `OFFICIAL_LOOKUP_ENABLED` | `true` | Enables allowlisted official CODESYS lookup. |
| `OFFICIAL_LOOKUP_TIMEOUT_MS` | `3500` | Fetch timeout per official page. |
| `OFFICIAL_LOOKUP_CACHE_TTL_SECONDS` | `3600` | In-memory documentation cache TTL. |
| `EXTERNAL_MAX_RESPONSE_BYTES` | `2000000` | Streaming limit for external responses. |
| `PDF_SEARCH_ENABLED` | `true` | Enables local PDF extraction and search. |
| `PDF_DOCS_DIR` | `docs/pdfs` | Folder scanned for `.pdf` files. |
| `PDF_MAX_TEXT_CHARS` | `200000` | Maximum extracted text stored per PDF. |
| `PDF_MAX_FILE_BYTES` | `50000000` | PDFs above this size are skipped. |
| `CODESYS_EXE` | auto-detected | Full path to `CODESYS.exe`. |
| `CODESYS_PROFILE` | CODESYS V3.5 SP21 Patch 1 | Profile used for headless execution. |
| `CODESYS_BRIDGE_DIR` | `bridge/` | Bridge runtime directory. |
| `CODESYS_BRIDGE_TIMEOUT_MS` | `240000` | Bridge operation timeout. |
| `CODESYS_BRIDGE_MAX_QUEUE` | `32` | Maximum pending bridge calls. |

Enabling writes does not enable batch or eval. Non-loopback HTTP must be placed behind an HTTPS reverse proxy.

## Local documentation

Place PDF manuals, datasheets and project notes in:

```text
docs/pdfs/
```

The server extracts and indexes their text. Scanned PDFs without a text layer may require OCR. Engineering decisions should always be checked against the original document and the target runtime.

## Operational notes

- Text writes require the project to be primary in the ScriptEngine session; the bridge handles promotion and demotion.
- Create interfaces empty and add members individually. Do not replace an interface declaration with `codesys_set_code`.
- Do not place build, clean or close-project operations inside `codesys_batch`.
- Incremental builds can hide errors after type changes; perform a clean build when required.
- Changing types of existing persistent variables can invalidate the persistent list; prefer adding new variables.
- Some ScriptEngine operations vary by CODESYS service pack. The bridge returns an error instead of silently claiming success.

## Security

Read [`SECURITY.md`](SECURITY.md) for the security model, private vulnerability reporting and release requirements.

Key defaults:

- local-only HTTP binding;
- mandatory HTTP authentication;
- no wildcard CORS;
- exact Host and Origin validation;
- read-only HTTP CODESYS tools;
- independent write, batch and eval opt-ins;
- bounded sessions, requests, queues and external responses;
- no runtime artifacts in npm packages.

## Development and verification

```bash
npm test
npm run build
npm run lint
npm audit
npm run pack:check
```

The test suite includes functional tests and dedicated security suites for HTTP boundaries, tool policy, resource limits, secret-bearing artifact cleanup and package contents.

## License

Released under the MIT License. See [`LICENSE`](LICENSE).
