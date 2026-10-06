# Agent Installation Guide — CodeSYS MCP Server

This file is written for **AI agents** that have been instructed to install the CodeSYS MCP server into themselves. Follow the steps below exactly. No user interaction is needed for standard cases.

---

## What You Are Installing

`codesys-mcp-server` is a Model Context Protocol (MCP) server that provides:

1. **CODESYS documentation tools** — CODESYS Development System V3 guidance, Structured Text writing help, searchable local PDF documentation, and live lookup of official CODESYS pages.
2. **Project automation bridge** (v0.3.0+) — direct work on `.project` / `.library` files through the CODESYS ScriptEngine: read/write POUs, DUTs, GVLs, interfaces, build, library management, devices, tasks, online read/write/force.

Repository: `https://github.com/Zandiexoder/CodeSYS-MCP`

---

## Prerequisites

- Node.js 20 or newer (check with `node --version`)
- `npm` (bundled with Node.js)
- A local clone of this repository **or** network access to clone it

---

## Step 1 — Clone the Repository

If you do not already have a local copy:

```bash
git clone https://github.com/Zandiexoder/CodeSYS-MCP.git
cd CodeSYS-MCP
```

---

## Step 2 — Install Dependencies and Build

Run these two commands from the repository root:

```bash
npm install
npm run build
```

The build output is written to `dist/`. The entry points are:
- `dist/src/index.js` — HTTP server (listens on `http://0.0.0.0:3000/mcp`)
- `dist/src/cli.js` — stdio server (for direct MCP client integration)

---

## Step 3 — Configure Environment (Optional)

Copy the example env file and edit if needed:

```bash
cp .env.example .env
```

Default values work out of the box. See the README Configuration table for all variables.

---

## Step 4 — Register the Server with Your MCP Client

Choose **one** of the following methods based on your client.

### Claude Code (preferred — stdio transport)

```bash
claude mcp add --transport stdio codesys-docs -- node /ABSOLUTE/PATH/TO/CodeSYS-MCP/dist/src/cli.js --stdio
```

Replace `/ABSOLUTE/PATH/TO/CodeSYS-MCP` with the real absolute path to the cloned repo. Use `pwd` from inside the repo directory to get it.

You can also write it directly to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "codesys-docs": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/CodeSYS-MCP/dist/src/cli.js", "--stdio"],
      "env": {
        "OFFICIAL_LOOKUP_ENABLED": "true"
      }
    }
  }
}
```

### Claude Code (HTTP transport — if stdio is not available)

Start the HTTP server first:

```bash
node /ABSOLUTE/PATH/TO/CodeSYS-MCP/dist/src/index.js &
```

Then register:

```bash
claude mcp add --transport http codesys-docs http://localhost:3000/mcp
```

### Codex CLI

```bash
codex mcp add codesys-docs -- node /ABSOLUTE/PATH/TO/CodeSYS-MCP/dist/src/cli.js --stdio
```

### From npm (no local clone needed)

If cloning is not possible, use the published package directly:

```bash
claude mcp add --transport stdio codesys-docs -- npx -y codesys-mcp-server --stdio
```

---

## Step 5 — Verify

After registering, confirm the server is visible to your client:

```bash
claude mcp list
```

You should see `codesys-docs` in the list. To confirm the tools are reachable, call:

```bash
claude mcp call codesys-docs list_codesys_pdfs
```

Or, if running HTTP, hit the health endpoint:

```bash
curl http://localhost:3000/healthz
```

---

## Available Tools (for reference)

### Documentation

| Tool | Purpose |
|------|---------|
| `search_codesys_docs` | Search curated and/or official CODESYS guidance |
| `get_codesys_topic` | Explain a CODESYS topic (POUs, timers, tasks, etc.) |
| `codesys_writing_guidance` | Practical ST and project-structure design guidance |
| `list_codesys_pdfs` | List PDF documents in the configured PDF folder |
| `search_codesys_pdfs` | Search text extracted from local PDF documents |
| `get_codesys_pdf` | Return extracted text from a specific local PDF |
| `get_codesys_page` | Fetch full text from an allowlisted CODESYS docs URL |
| `crawl_codesys_help` | Crawl and index the CODESYS help site |

### Project automation (bridge)

Read/write: `codesys_project_open`, `codesys_project_info`, `codesys_list_objects` (use `slim: true` for large trees), `codesys_get_object`, `codesys_dump_pou_code` (bulk-read all ST code in one call), `codesys_create_pou`, `codesys_create_member`, `codesys_create_interface`, `codesys_create_dut`, `codesys_create_gvl`, `codesys_set_code`, `codesys_delete_object` (requires `confirm: true`), `codesys_rename_object`, `codesys_move_object`, `codesys_set_exclude_from_build`.

Build/validate: `codesys_build`, `codesys_validate_library`, `codesys_clean_all`, `codesys_application_build_action`, `codesys_online_change_check`, `codesys_signature_crc`, `codesys_get_compiler_version`, `codesys_set_compiler_version_newest`.

Libraries: `codesys_lib_install`, `codesys_lib_add`, `codesys_lib_remove`, `codesys_lib_list`.

Batch/safety: `codesys_batch` (many edits in one session, `dry_run` supported), `codesys_eval` (arbitrary ScriptEngine expression), `codesys_snapshot` / `codesys_snapshot_list` / `codesys_snapshot_restore`.

Lifecycle/devices/tasks: `codesys_create_project`, `codesys_list_applications`, `codesys_set_active_application`, `codesys_save_project`, `codesys_close_project`, `codesys_save_project_as`, `codesys_save_project_archive`, `codesys_list_open_projects`, `codesys_list_tasks`, `codesys_configure_task`, `codesys_add_device`, `codesys_device_info`, `codesys_list_device_parameters`, `codesys_set_device_parameter`, `codesys_set_device_state`, `codesys_device_reachable`, `codesys_device_rebind`, `codesys_device_user_add`, `codesys_scan_network`, `codesys_io_mappings_csv`, `codesys_add_file`, `codesys_native_export`, `codesys_native_import`, `codesys_export_plcopen_xml`, `codesys_import_plcopen_xml`, `codesys_grant_object_access`.

Online (need a running PLC runtime and gateway): `codesys_online_login` / `codesys_online_logout` / `codesys_online_status`, `codesys_online_read`, `codesys_online_write`, `codesys_online_force` / `codesys_online_unforce`, `codesys_download_application`, `codesys_application_state`, `codesys_application_start_stop`, `codesys_application_reset`, `codesys_boot_application_create`, `codesys_plc_file_list`, `codesys_plc_file_delete`, `codesys_plc_file_transfer`, `codesys_source_download`, `codesys_source_upload`.

OPC UA / NVL: `codesys_symbol_config_create`, `codesys_symbol_config_list`, `codesys_symbol_config_set_access`, `codesys_symbol_config_settings_get` / `_set`, `codesys_symbol_config_export_xsd`, `codesys_nvl_sender_set`, `codesys_nvl_receiver_create`.

---

## Operating Rules for Project Automation (read before calling bridge tools)

These are verified on CODESYS V3.5 SP21 Patch 1. Ignoring them wastes hours.

1. **The project must not be open in the CODESYS GUI** while you call bridge tools (file lock). Symmetrically, call `codesys_close_project` before handing the project back to the GUI.
2. **Warm daemon**: the first bridge call auto-starts a headless CODESYS daemon (`--noUI`) that keeps the session hot (~1–3 s per call afterwards; cold calls cost 10–30 s). Disable with env `CODESYS_BRIDGE_AUTOSTART=0`. Exactly one daemon may run — never start a second one manually.
3. **Never act blind**: `codesys_list_objects` / `codesys_get_object` before every change.
4. **Series of edits = one `codesys_batch`** (auto-saves at the end; cold runs lose unsaved changes). But **never** put `build`, `clean_all` or `close_project` steps inside a batch — builds need the primary project and fail in batch; `close_project` closes the batch's own handle and corrupts the rest. Build is always a standalone `codesys_build` call.
5. **Interfaces**: create empty via `codesys_create_interface`, add members via `codesys_create_member`. Never `codesys_set_code` an interface declaration — it corrupts the object. A method implementing an interface member must be PUBLIC.
6. **Build verdicts**: trust the compiler summary ("0 errors") in the returned messages, not raw return values. Incremental builds hide errors — after touching PERSISTENT variable types or interface methods, run `codesys_clean_all` + rebuild. Never change the type of an existing PERSISTENT variable (the "incompatible persistent list" error is unrecoverable via file deletion); add new variables instead.
7. **Destructive ops** (`codesys_delete_object`, `codesys_snapshot_restore`, `codesys_plc_file_delete`, force/reset-origin) require explicit user approval and `confirm: true`. Take a `codesys_snapshot` before risky edits.
8. **Errors are honest**: when the ScriptEngine cannot do something on SP21 (remove POU from a task, delete task objects, offline boot application, compiler version read), the tool returns an explicit error — do not retry-loop, fall back to the GUI.

---

## Troubleshooting

- **`dist/` not found** — you skipped `npm run build`. Run it.
- **Node version error** — upgrade to Node 20+.
- **Port 3000 already in use** — set `PORT=3001` in `.env` before starting the HTTP server and update the `claude mcp add` URL accordingly.
- **`OFFICIAL_LOOKUP_ENABLED` warnings** — the server fetches official CODESYS pages; this requires internet access. Set `OFFICIAL_LOOKUP_ENABLED=false` in `.env` to disable.
- **Bridge: "CODESYS.exe not found"** — set `CODESYS_EXE` in `.env` to the full path of CODESYS.exe.
- **Bridge: "project is locked / in use"** — the project is open in the GUI or held by a stale daemon. Close the GUI; if a `*.~u` file sits next to the project after a killed CODESYS process, delete it.
- **Bridge: warm daemon silent** — stop it (`python bridge/bridge_client.py stop`), make sure only one CODESYS `--noUI` process exists, and let the next call auto-start a fresh daemon.
