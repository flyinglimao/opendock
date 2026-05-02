// lib/agent-loop.ts
// Shared agent loop logic used by both the interactive chat endpoint and the
// automation trigger endpoint.

import {
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
} from "@0glabs/0g-serving-broker";
import { KB_TOOLS, executeKBTool, type KBFile } from "@/lib/kb-tools";
import { WEB_SEARCH_TOOL, executeBraveSearch } from "@/lib/web-search";

export type { KBFile };

const ZG_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  process.env.ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

const MAX_TOOL_ITERATIONS = 8;

// ---- types ----

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LoopResult {
  content: string;
  usage: unknown;
  chatID: string | null;
  ok: boolean;
  errorData?: unknown;
  errorStatus?: number;
}

// ---- helpers ----

export async function getServiceMetadata(providerAddress: string) {
  const broker = await createZGComputeNetworkReadOnlyBroker(ZG_RPC);
  const services = await broker.inference.listService();
  const service = services.find(
    (item) => item.provider.toLowerCase() === providerAddress.toLowerCase()
  );
  if (!service) throw new Error("Provider not found");
  return {
    endpoint: `${service.url}/v1/proxy`,
    model: service.model,
  };
}

// Returns operational instructions about available tools. Intentionally kept
// separate from the agent's persona so neither overrides the other.
export function buildToolInstructions(hasKB: boolean): string {
  let instructions = "";
  if (hasKB) {
    instructions +=
      "You have access to a knowledge base. Use the provided tools" +
      " (kb_list_files, kb_search, kb_read_file) to find and read relevant" +
      " information before answering questions that require specific knowledge.\n\n";
  }
  instructions +=
    "You have access to a web_search tool. Use it to look up current" +
    " information, recent events, or anything that may not be in your training data." +
    " If the tool returns an error asking the user to configure an API key, relay" +
    " that message to the user as-is.";
  return instructions;
}

// ---- agent loop ----

// agentPrompt is the agent's persona/system instructions (from the encrypted
// payload). It is sent as its own system message, separate from toolInstructions,
// so the two do not interfere with each other.
export async function runAgentLoop(
  endpoint: string,
  model: string,
  authorization: string,
  agentPrompt: string | undefined,
  messages: ChatMessage[],
  kbFiles: KBFile[],
  hostedBroker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>> | null,
  providerAddress: string,
  braveApiKey: string | null
): Promise<LoopResult> {
  const tools = [
    ...(kbFiles.length > 0 ? [...KB_TOOLS] : []),
    WEB_SEARCH_TOOL,
  ];

  const toolInstructions = buildToolInstructions(kbFiles.length > 0);

  // Build the fixed system messages that prefix every request in the loop.
  // Agent persona and tool instructions are kept as separate roles so the LLM
  // treats them independently and the persona is not diluted by operational text.
  const systemMessages: LLMMessage[] = [];
  if (agentPrompt?.trim()) {
    systemMessages.push({ role: "system", content: agentPrompt.trim() });
  }
  systemMessages.push({ role: "system", content: toolInstructions });

  const internalMessages: LLMMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let lastChatID: string | null = null;
  let lastUsage: unknown = null;
  let assistantContent = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const reqBody: Record<string, unknown> = {
      model,
      messages: [...systemMessages, ...internalMessages],
      tools,
    };

    const llmResponse = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(reqBody),
    });

    const llmData = (await llmResponse.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
      id?: string;
      chatID?: string;
      usage?: unknown;
      error?: unknown;
    };

    if (!llmResponse.ok) {
      return {
        content: "",
        usage: null,
        chatID: null,
        ok: false,
        errorData: llmData.error ?? "0G provider request failed",
        errorStatus: llmResponse.status,
      };
    }

    const chatID =
      llmResponse.headers.get("ZG-Res-Key") ??
      llmResponse.headers.get("zg-res-key") ??
      llmData.id ??
      llmData.chatID ??
      null;
    lastChatID = chatID;
    lastUsage = llmData.usage;

    if (hostedBroker && chatID) {
      await hostedBroker.inference.processResponse(
        providerAddress,
        chatID,
        llmData.usage ? JSON.stringify(llmData.usage) : undefined
      );
    }

    const message = llmData.choices?.[0]?.message;
    if (message?.content) assistantContent = message.content;

    if (!message?.tool_calls?.length) {
      return {
        content: assistantContent,
        usage: lastUsage,
        chatID: lastChatID,
        ok: true,
      };
    }

    internalMessages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    for (const toolCall of message.tool_calls) {
      let toolArgs: Record<string, string> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, string>;
      } catch {
        // ignore parse errors; handlers deal with missing args gracefully
      }

      let result: string;
      if (toolCall.function.name === "web_search") {
        if (braveApiKey) {
          result = await executeBraveSearch(toolArgs.query ?? "", braveApiKey);
        } else {
          result = JSON.stringify({
            error:
              "Web search is not configured. Please ask the user to add their" +
              " Brave Search API key in the OpenDock Dashboard (Settings section)" +
              " to enable this feature.",
          });
        }
      } else {
        result = executeKBTool(toolCall.function.name, toolArgs, kbFiles);
      }
      internalMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return {
    content: assistantContent,
    usage: lastUsage,
    chatID: lastChatID,
    ok: true,
  };
}
