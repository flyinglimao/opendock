// User-level (per-wallet) hosted compute wallet endpoint.
// Unlike /api/token/[id]/compute-wallet, this is keyed by the user's wallet
// address only — no agent / tokenId required.

import { NextRequest, NextResponse } from "next/server";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { Contract, getAddress } from "ethers";
import { isAddress } from "viem";
import {
  getAgentComputeDelegateImplementation,
  getAgentComputeFundingConfig,
  getAgentComputeProvider,
  getUserComputeWalletSigner,
  hasAgentComputeRootSecret,
  hasAgentComputeRelayerSecret,
} from "@/lib/agent-compute-wallet";
import { COMPUTE_PROVIDERS } from "@/lib/compute-providers";

const EIP7702_DELEGATION_PREFIX = "0xef0100";
const LEDGER_SERVICE_ABI = [
  "function getServiceInfo(address serviceAddress) view returns (tuple(address serviceAddress,address serviceContract,string serviceType,string version,string fullName,string description,bool isRecommended,uint256 registeredAt))",
];
const DELEGATE_OWNER_ABI = ["function owner() view returns (address)"];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function formatLedgerBalance(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value ?? "0");
}

function getDelegatedImplementation(code: string): string | null {
  const normalized = code.toLowerCase();
  if (
    normalized.length !== EIP7702_DELEGATION_PREFIX.length + 40 ||
    !normalized.startsWith(EIP7702_DELEGATION_PREFIX)
  ) {
    return null;
  }
  return getAddress(`0x${normalized.slice(EIP7702_DELEGATION_PREFIX.length)}`);
}

async function getInferenceServiceName(): Promise<string> {
  const provider = getAgentComputeProvider();
  const { ledgerAddress, inferenceAddress } = getAgentComputeFundingConfig();
  const ledger = new Contract(ledgerAddress, LEDGER_SERVICE_ABI, provider);
  const info = await ledger.getServiceInfo(inferenceAddress);
  return String(info.fullName);
}

async function getDelegateOwner(address: string): Promise<string | null> {
  try {
    const provider = getAgentComputeProvider();
    const delegate = new Contract(address, DELEGATE_OWNER_ABI, provider);
    const value = String(await delegate.owner());
    return value === ZERO_ADDRESS ? null : getAddress(value);
  } catch {
    return null;
  }
}

async function getWalletHostedState(userAddress: string, providerAddress: string | null) {
  const { address: walletAddress, signer } = getUserComputeWalletSigner(userAddress);
  const broker = await createZGComputeNetworkBroker(signer);
  const nativeBalanceWei = (await signer.provider!.getBalance(walletAddress)).toString();
  const code = await signer.provider!.getCode(walletAddress);
  const delegatedImplementation = getDelegatedImplementation(code);
  const configuredImplementation = getAgentComputeDelegateImplementation();
  const normalizedImplementation =
    configuredImplementation && isAddress(configuredImplementation)
      ? getAddress(configuredImplementation)
      : null;
  const ownerAddress = delegatedImplementation ? await getDelegateOwner(walletAddress) : null;
  const normalizedUserAddress = getAddress(userAddress);
  const delegateReady =
    Boolean(normalizedImplementation) &&
    delegatedImplementation?.toLowerCase() === normalizedImplementation?.toLowerCase() &&
    ownerAddress?.toLowerCase() === normalizedUserAddress.toLowerCase();
  const funding = getAgentComputeFundingConfig();
  const serviceName = await getInferenceServiceName();

  let ledger = {
    hasLedger: false,
    totalBalanceWei: "0",
    availableBalanceWei: "0",
  };
  try {
    const info = await broker.ledger.getLedger();
    ledger = {
      hasLedger: true,
      totalBalanceWei: formatLedgerBalance(info.totalBalance),
      availableBalanceWei: formatLedgerBalance(info.availableBalance),
    };
  } catch {
    // No hosted ledger exists yet.
  }

  let providerBalanceWei = "0";
  let providerBalances: { address: string; balanceWei: string }[] = COMPUTE_PROVIDERS.map(
    (p) => ({ address: p.address, balanceWei: "0" })
  );
  if (providerAddress) {
    try {
      const providers = await broker.ledger.getProvidersWithBalance("inference");
      providerBalances = COMPUTE_PROVIDERS.map((knownProvider) => {
        const match = providers.find(
          ([p]) => p.toLowerCase() === knownProvider.address.toLowerCase()
        );
        return { address: knownProvider.address, balanceWei: match?.[1]?.toString() ?? "0" };
      });
      const match = providers.find(
        ([p]) => p.toLowerCase() === providerAddress.toLowerCase()
      );
      providerBalanceWei = match?.[1]?.toString() ?? "0";
    } catch {
      // No provider sub-account exists yet.
    }
  }

  return {
    wallet: { address: walletAddress, nativeBalanceWei },
    delegate: {
      ready: delegateReady,
      ownerAddress,
      implementationAddress: normalizedImplementation,
      currentImplementationAddress: delegatedImplementation,
      setupAvailable: Boolean(normalizedImplementation && hasAgentComputeRelayerSecret()),
    },
    funding: { ...funding, serviceName },
    ledger,
    providerBalanceWei,
    providerBalances,
  };
}

export async function GET(req: NextRequest) {
  const addressParam = req.nextUrl.searchParams.get("address");
  if (!addressParam || !isAddress(addressParam)) {
    return NextResponse.json(
      { error: "address query parameter is required" },
      { status: 400 }
    );
  }

  if (!hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Hosted compute wallet root is not configured", configured: false },
      { status: 503 }
    );
  }

  const userAddress = getAddress(addressParam);
  const providerAddress = req.nextUrl.searchParams.get("provider");
  try {
    const state = await getWalletHostedState(userAddress, providerAddress);
    return NextResponse.json({ configured: true, ...state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
