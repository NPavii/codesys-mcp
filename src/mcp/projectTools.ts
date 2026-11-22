import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runBridgeTaskSerial } from "./bridge.js";
import { isToolAllowed, type ToolPolicy } from "./policy.js";

const projectPathSchema = z
  .string()
  .min(1)
  .describe("Absolute path to the .project file, e.g. D:/CodeSys Project/MyProject.project");

const objectPathSchema = z
  .string()
  .min(1)
  .describe("Object path inside the project tree, e.g. 'MyFolder/FB_Motor'.");

function asTextResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

const BRIDGE_NOTE =
  "If the warm daemon is running, calls take ~1-3 s; otherwise each call starts a headless CODESYS instance. " +
  "The project must NOT be open in the CODESYS GUI at the same time.";

async function runTask(op: string, args: Record<string, unknown>, policy: ToolPolicy) {
  const result = await runBridgeTaskSerial({ op, args });
  if (policy.transport === "http") {
    console.info(JSON.stringify({ event: "bridge_task", op, ok: result.ok }));
  }
  return asTextResult({ ...result, note: result.ok ? BRIDGE_NOTE : undefined });
}

type Schema = Record<string, z.ZodTypeAny>;
interface ProjectToolSpec {
  name: string;
  title: string;
  description: string;
  op: string;
  schema: Schema;
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
}

const PROJECT_TOOLS: ProjectToolSpec[] = [
  {
    name: "codesys_project_open",
    title: "Open CODESYS Project",
    description:
      "Open a CODESYS project in the headless bridge and return basic info. " + BRIDGE_NOTE,
    op: "open_project",
    schema: { project: projectPathSchema },
    mapArgs: (args) => ({ path: args.project })
  },
  {
    name: "codesys_project_info",
    title: "CODESYS Project Info",
    description: "Return path, dirty state and active application of the project. " + BRIDGE_NOTE,
    op: "project_info",
    schema: { project: projectPathSchema }
  },
  {
    name: "codesys_list_objects",
    title: "List CODESYS Project Objects",
    description: "List objects in the CODESYS project tree. " + BRIDGE_NOTE,
    op: "list_objects",
    schema: {
      project: projectPathSchema,
      path: objectPathSchema.optional(),
      recursive: z.boolean().optional(),
      max_depth: z.number().int().min(1).max(50).optional(),
      slim: z.boolean().optional()
    }
  },
  {
    name: "codesys_get_object",
    title: "Get CODESYS Object Source",
    description: "Get declaration and implementation text of a project object. " + BRIDGE_NOTE,
    op: "get_object",
    schema: {
      project: projectPathSchema,
      path: objectPathSchema,
      slim: z.boolean().optional()
    }
  },
  {
    name: "codesys_create_pou",
    title: "Create CODESYS POU",
    description: "Create a PROGRAM / FUNCTION_BLOCK / FUNCTION. " + BRIDGE_NOTE,
    op: "create_pou",
    schema: {
      project: projectPathSchema,
      name: z.string().min(1).max(200),
      pou_type: z.enum(["program", "function_block", "function"]),
      folder: objectPathSchema.optional(),
      return_type: z.string().max(500).optional(),
      base_type: z.string().max(500).optional(),
      interfaces: z.string().max(2000).optional(),
      declaration: z.string().max(1_000_000).optional(),
      implementation: z.string().max(1_000_000).optional()
    }
  },
  {
    name: "codesys_create_member",
    title: "Create CODESYS POU Member",
    description: "Create an action, method, or property on an existing POU. " + BRIDGE_NOTE,
    op: "create_member",
    schema: {
      project: projectPathSchema,
      path: objectPathSchema,
      kind: z.enum(["action", "method", "property"]),
      name: z.string().min(1).max(200),
      return_type: z.string().max(500).optional(),
      implementation: z.string().max(1_000_000).optional()
    }
  },
  {
    name: "codesys_create_dut",
    title: "Create CODESYS DUT",
    description: "Create a data unit type. " + BRIDGE_NOTE,
    op: "create_dut",
    schema: {
      project: projectPathSchema,
      name: z.string().min(1).max(200),
      dut_type: z.enum(["structure", "enumeration", "alias", "union"]).optional(),
      folder: objectPathSchema.optional(),
      base_type: z.string().max(500).optional(),
      declaration: z.string().max(1_000_000).optional()
    }
  },
  {
    name: "codesys_create_gvl",
    title: "Create CODESYS GVL",
    description: "Create a global variable list. " + BRIDGE_NOTE,
    op: "create_gvl",
    schema: {
      project: projectPathSchema,
      name: z.string().min(1).max(200),
      folder: objectPathSchema.optional(),
      declaration: z.string().max(1_000_000).optional()
    }
  },
  {
    name: "codesys_create_interface",
    title: "Create CODESYS Interface",
    description: "Create an empty INTERFACE; add members separately. " + BRIDGE_NOTE,
    op: "create_interface",
    schema: {
      project: projectPathSchema,
      name: z.string().min(1).max(200),
      folder: objectPathSchema.optional()
    }
  },
  {
    name: "codesys_set_code",
    title: "Set CODESYS Object Code",
    description: "Replace declaration or implementation text of an existing object. " + BRIDGE_NOTE,
    op: "set_code",
    schema: {
      project: projectPathSchema,
      path: objectPathSchema,
      part: z.enum(["declaration", "implementation"]),
      text: z.string().max(1_000_000)
    }
  },
  {
    name: "codesys_close_project",
    title: "Close CODESYS Project",
    description: "Close the project in the warm session and release the file lock. " + BRIDGE_NOTE,
    op: "close_project",
    schema: { project: projectPathSchema, save: z.boolean().optional() }
  },
  {
    name: "codesys_save_project",
    title: "Save CODESYS Project",
    description: "Save the project to disk. " + BRIDGE_NOTE,
    op: "save_project",
    schema: { project: projectPathSchema }
  }
];

export function registerProjectTools(server: McpServer, policy: ToolPolicy): void {
  for (const spec of PROJECT_TOOLS) {
    if (!isToolAllowed(spec.name, policy)) continue;
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.schema },
      async (args) => {
        const typedArgs = args as Record<string, unknown>;
        return runTask(spec.op, spec.mapArgs?.(typedArgs) ?? typedArgs, policy);
      }
    );
  }
}
