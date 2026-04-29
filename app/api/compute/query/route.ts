// app/api/compute/query/route.ts
// POST → send an inference query to 0G Compute via the serving broker (server-side only)

import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import OpenAI from "openai";

const ZG_RPC = process.env.ZG_EVM_RPC ?? "https://rpc.ankr.com/0g_galileo_testnet_evm";

function getSigner(privateKey: string) {
  const provider = new ethers.JsonRpcProvider(ZG_RPC);
  return new ethers.Wallet(privateKey, provider);
}

interface QueryBody {
  providerAddress: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
}

export async function POST(req: NextRequest) {
  const pk = req.headers.get("x-wallet-pk");
  if (!pk) return NextResponse.json({ error: "Missing x-wallet-pk header" }, { status: 400 });

  const { providerAddress, messages } = (await req.json()) as QueryBody;

  try {
    const signer = getSigner(pk);
    const broker = await createZGComputeNetworkBroker(signer);

    // Ensure provider is acknowledged and funded
    try { await broker.inference.acknowledgeProviderSigner(providerAddress); } catch { /* ok */ }
    try {
      await broker.ledger.transferFund(providerAddress, "inference", ethers.parseEther("1"));
    } catch { /* ok — may already be funded */ }

    const lastMessage = messages[messages.length - 1]?.content ?? "";
    const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
    const headers = await broker.inference.getRequestHeaders(providerAddress, lastMessage);

    const client = new OpenAI({ baseURL: endpoint, apiKey: "" });
    const completion = await client.chat.completions.create(
      { messages, model },
      { headers: headers as unknown as Record<string, string> }
    );

    const content = completion.choices[0]?.message?.content ?? "";

    // Settle TEE-verified response
    await broker.inference.processResponse(providerAddress, completion.id, content);

    return NextResponse.json({ content, chatId: completion.id, model });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
