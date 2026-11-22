import type { AppConfig } from "../config.js";

export type McpTransportKind = "stdio" | "http";

export interface ToolPolicy {
  transport: McpTransportKind;
  writes: boolean;
  eval: boolean;
  batch: boolean;
}

const MUTATING_PROJECT_TOOLS = new Set([
  "codesys_create_pou",
  "codesys_create_member",
  "codesys_create_dut",
  "codesys_create_gvl",
  "codesys_create_interface",
  "codesys_set_code",
  "codesys_close_project",
  "codesys_save_project"
]);

const MUTATING_BRIDGE_TOOLS = new Set([
  "codesys_build",
  "codesys_snapshot",
  "codesys_snapshot_restore",
  "codesys_delete_object",
  "codesys_lib_install",
  "codesys_lib_add",
  "codesys_lib_remove",
  "codesys_add_file",
  "codesys_native_export",
  "codesys_native_import",
  "codesys_online_login",
  "codesys_online_logout",
  "codesys_online_write",
  "codesys_online_force",
  "codesys_online_unforce",
  "codesys_create_project",
  "codesys_set_active_application",
  "codesys_save_project_as",
  "codesys_save_project_archive",
  "codesys_clean_all",
  "codesys_set_compiler_version_newest",
  "codesys_rename_object",
  "codesys_move_object",
  "codesys_set_exclude_from_build",
  "codesys_grant_object_access",
  "codesys_export_plcopen_xml",
  "codesys_import_plcopen_xml",
  "codesys_configure_task",
  "codesys_add_device",
  "codesys_set_device_parameter",
  "codesys_set_device_state",
  "codesys_device_rebind",
  "codesys_device_user_add",
  "codesys_io_mappings_csv",
  "codesys_application_build_action",
  "codesys_download_application",
  "codesys_application_start_stop",
  "codesys_application_reset",
  "codesys_boot_application_create",
  "codesys_plc_file_delete",
  "codesys_plc_file_transfer",
  "codesys_source_download",
  "codesys_source_upload",
  "codesys_symbol_config_create",
  "codesys_symbol_config_set_access",
  "codesys_symbol_config_settings_set",
  "codesys_symbol_config_export_xsd",
  "codesys_nvl_sender_set",
  "codesys_nvl_receiver_create",
  "codesys_rename_symbol",
  "codesys_set_simulation_mode"
]);

const MUTATING_BRIDGE_OPS = new Set([
  "build",
  "snapshot",
  "snapshot_restore",
  "delete_object",
  "lib_install",
  "lib_add",
  "lib_remove",
  "add_file",
  "native_export",
  "native_import",
  "online_login",
  "online_logout",
  "online_write",
  "online_force",
  "online_unforce",
  "create_project",
  "set_active_application",
  "save_project_as",
  "save_project_archive",
  "clean_all",
  "set_compiler_version_newest",
  "rename_object",
  "move_object",
  "set_exclude_from_build",
  "grant_object_access",
  "export_plcopen_xml",
  "import_plcopen_xml",
  "configure_task",
  "ensure_task",
  "add_device",
  "set_device_parameter",
  "set_device_state",
  "device_rebind",
  "device_user_add",
  "io_mappings_csv",
  "application_build_action",
  "download_application",
  "application_start_stop",
  "application_reset",
  "boot_application_create",
  "plc_file_delete",
  "plc_file_transfer",
  "source_download",
  "source_upload",
  "symbol_config_create",
  "symbol_config_set_access",
  "symbol_config_settings_set",
  "symbol_config_export_xsd",
  "nvl_sender_set",
  "nvl_receiver_create",
  "rename_symbol",
  "set_simulation_mode"
]);

export function makeToolPolicy(config: AppConfig, transport: McpTransportKind): ToolPolicy {
  return {
    transport,
    writes: transport === "stdio" || config.httpWriteEnabled,
    eval: transport === "stdio" || config.httpEvalEnabled,
    batch: transport === "stdio" || config.httpBatchEnabled
  };
}

export function isToolAllowed(name: string, policy: ToolPolicy): boolean {
  if (policy.transport === "stdio") return true;
  if (name === "codesys_eval") return policy.eval;
  if (name === "codesys_batch") return policy.batch;
  if (policy.writes) return true;
  return !MUTATING_PROJECT_TOOLS.has(name) && !MUTATING_BRIDGE_TOOLS.has(name);
}

export function assertBatchStepsAllowed(steps: unknown, policy: ToolPolicy): void {
  if (policy.transport === "stdio" || !Array.isArray(steps)) return;
  for (const rawStep of steps) {
    const step = rawStep as { op?: unknown };
    const op = typeof step.op === "string" ? step.op : "";
    if (op === "batch") {
      throw new Error("Nested batch operations are forbidden over HTTP.");
    }
    if (op === "eval" && !policy.eval) {
      throw new Error("The eval operation is disabled over HTTP.");
    }
    if (!policy.writes && MUTATING_BRIDGE_OPS.has(op)) {
      throw new Error(`The bridge operation is disabled in read-only HTTP mode: ${op}`);
    }
  }
}
