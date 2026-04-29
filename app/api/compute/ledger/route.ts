// app/api/compute/ledger/route.ts
// GET  → get ledger info (balance)
// POST → deposit to ledger (add or top-up)

import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const ZG_RPC = process.env.ZG_EVM_RPC ?? "https://rpc.ankr.com/0g_galileo_testnet_evm";

function getSigner(privateKey: string) {
  const provider = new ethers.JsonRpcProvider(ZG_RPC);
  return new ethers.Wallet(privateKey, provider);
}

export async function GET(req: NextRequest) {
  const pk = req.headers.get("x-wallet-pk");
  if (!pk) return NextResponse.json({ error: "Missing x-wallet-pk header" }, { status: 400 });

  try {
    const signer = getSigner(pk);
    const broker = await createZGComputeNetworkBroker(signer);
    const info = await broker.ledger.getLedger();
    const balWei = info && (info as unknown[]).length > 0 ? BigInt(String((info as unknown[])[0])) : BigInt(0);
    const balOg = Number(balWei) / 1e18;
    return NextResponse.json({ balance: balOg, balanceWei: balWei.toString() });
  } catch (err) {
    return NextResponse.json({ error: String(err), balance: 0 }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const pk = req.headers.get("x-wallet-pk");
  if (!pk) return NextResponse.json({ error: "Missing x-wallet-pk header" }, { status: 400 });

  const { amount, isNew } = await req.json() as { amount: number; isNew?: boolean };
  try {
    const signer = getSigner(pk);
    const broker = await createZGComputeNetworkBroker(signer);
    if (isNew) {
      await broker.ledger.addLedger(amount);
    } else {
      await broker.ledger.depositFund(parseFloat(String(amount)));
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
