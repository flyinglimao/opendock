// app/api/token/[id]/chat/route.ts
// Auth-gated backend proxy for 0G Compute.
//
// The browser generates the 0G serving Authorization header with the user's
// wallet, but the server decrypts the agent intelligence and calls the model.
// This keeps the system prompt out of browser responses.

import { NextRequest, NextResponse } from "next/server";
import {
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
} from "@0glabs/0g-serving-broker";
import { prisma } from "@/lib/db";
import { verifyAuthHeader, checkOnChainAuth } from "@/lib/auth";
import { downloadZGJson } from "@/lib/0g-download";
import {
  getAgentComputeWalletSigner,
  hasAgentComputeRootSecret,
} from "@/lib/agent-compute-wallet";
import {
  decryptAgentIntelligence,
  type EncryptedAgentPayload,
} from "@/lib/encryption";

const ZG_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  process.env.ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  providerAddress: string;
  walletMode?: "hosted" | "user";
  servingHeaders?: {
    Authorization?: string;
  } | null;
  messages: ChatMessage[];
}

function buildSystemPrompt(
  systemPrompt: string | undefined,
  knowledgeBase: string | null | undefined,
  knowledgeBaseName: string | null | undefined
): string {
  const base = systemPrompt?.trim() ?? "";
  const kb = knowledgeBase?.trim();
  if (!kb) return base;
  const label = knowledgeBaseName ? `Knowledge base (${knowledgeBaseName})` : "Knowledge base";
  return `${base}\n\n${label}:\n${kb}`;
}

async function getServiceMetadata(providerAddress: string) {
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { isAuthorized } = await checkOnChainAuth(id, address);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as ChatBody;
  const walletMode = body.walletMode ?? "user";
  if (walletMode !== "hosted" && walletMode !== "user") {
    return NextResponse.json(
      { error: "walletMode must be hosted or user" },
      { status: 400 }
    );
  }
  if (!body.providerAddress) {
    return NextResponse.json(
      { error: "providerAddress required" },
      { status: 400 }
    );
  }
  if (walletMode === "user" && !body.servingHeaders?.Authorization) {
    return NextResponse.json(
      { error: "serving Authorization header required for user wallet mode" },
      { status: 400 }
    );
  }
  if (walletMode === "hosted" && !hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Hosted compute wallet root is not configured" },
      { status: 503 }
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const token = await prisma.agentToken.findUnique({
    where: { tokenId: id },
    select: { dataHash: true },
  });
  if (!token?.dataHash) {
    return NextResponse.json(
      { error: "Encrypted intelligence is not registered yet" },
      { status: 503 }
    );
  }

  const envelope = await downloadZGJson<EncryptedAgentPayload>(token.dataHash);
  if (!envelope) {
    return NextResponse.json(
      { error: "Encrypted intelligence not available" },
      { status: 503 }
    );
  }

  let systemPrompt: string;
  try {
    const payload = decryptAgentIntelligence(envelope);
    systemPrompt = buildSystemPrompt(
      payload.systemPrompt,
      payload.knowledgeBase,
      payload.knowledgeBaseName
    );
  } catch {
    return NextResponse.json(
      { error: "Encrypted intelligence could not be decrypted with this server key" },
      { status: 503 }
    );
  }

  try {
    const { endpoint, model } = await getServiceMetadata(body.providerAddress);
    let authorization = body.servingHeaders?.Authorization ?? "";
    let hostedBroker:
      | Awaited<ReturnType<typeof createZGComputeNetworkBroker>>
      | null = null;

    if (walletMode === "hosted") {
      const { signer } = getAgentComputeWalletSigner(id, address);
      hostedBroker = await createZGComputeNetworkBroker(signer);
      const hostedHeaders = await hostedBroker.inference.getRequestHeaders(
        body.providerAddress
      );
      authorization = hostedHeaders.Authorization;
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...body.messages,
        ],
      }),
    });

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      id?: string;
      chatID?: string;
      usage?: unknown;
      error?: unknown;
    };

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error ?? "0G provider request failed" },
        { status: response.status }
      );
    }

    const chatID =
      response.headers.get("ZG-Res-Key") ??
      response.headers.get("zg-res-key") ??
      data.id ??
      data.chatID ??
      null;

    if (walletMode === "hosted" && hostedBroker && chatID) {
      await hostedBroker.inference.processResponse(
        body.providerAddress,
        chatID,
        data.usage ? JSON.stringify(data.usage) : undefined
      );
    }

    return NextResponse.json({
      content: data.choices?.[0]?.message?.content ?? "",
      chatID: walletMode === "hosted" ? null : chatID,
      usage: data.usage ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
