// lib/kb-tools.ts
// Knowledge base tool definitions and server-side execution for the agent loop.
// Agents call these instead of having the full KB embedded in the system prompt.

export interface KBFile {
  name: string;
  content: string;
}

export const KB_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "kb_list_files",
      description:
        "List all files available in the knowledge base with their names, byte sizes, and line counts.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "kb_search",
      description:
        "Search for a text query across all knowledge base files. Returns up to 50 matching lines with filename and line number.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for (case-insensitive)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "kb_read_file",
      description:
        "Read the full content of a specific knowledge base file. Use kb_list_files to discover available filenames.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Exact filename to read",
          },
        },
        required: ["filename"],
      },
    },
  },
] as const;

export function executeKBTool(
  toolName: string,
  args: Record<string, string>,
  files: KBFile[]
): string {
  if (toolName === "kb_list_files") {
    return JSON.stringify(
      files.map((f) => ({
        name: f.name,
        bytes: Buffer.byteLength(f.content, "utf8"),
        lines: f.content.split("\n").length,
      }))
    );
  }

  if (toolName === "kb_search") {
    const query = (args.query ?? "").toLowerCase();
    if (!query) return JSON.stringify([]);
    const results: Array<{ file: string; line: number; content: string }> = [];
    outer: for (const file of files) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(query)) {
          results.push({ file: file.name, line: i + 1, content: lines[i].trim() });
          if (results.length >= 50) break outer;
        }
      }
    }
    return JSON.stringify(results);
  }

  if (toolName === "kb_read_file") {
    const file = files.find((f) => f.name === args.filename);
    if (!file) {
      return JSON.stringify({
        error: `File "${args.filename}" not found. Use kb_list_files to see available files.`,
      });
    }
    return JSON.stringify({ name: file.name, content: file.content });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

/** Normalise the payload's KB data into a flat KBFile array (handles both legacy and new format). */
export function getKBFiles(payload: {
  knowledgeBase?: string | null;
  knowledgeBaseName?: string | null;
  knowledgeBaseFiles?: KBFile[];
}): KBFile[] {
  if (payload.knowledgeBaseFiles?.length) {
    return payload.knowledgeBaseFiles;
  }
  if (payload.knowledgeBase?.trim()) {
    return [
      {
        name: payload.knowledgeBaseName ?? "knowledge-base.txt",
        content: payload.knowledgeBase,
      },
    ];
  }
  return [];
}
