// Auth-gated hosted compute wallet endpoint.
// The caller signs the normal OpenDock token auth message; the server verifies
// token access before allocating or operating a hosted 0G Compute wallet.

import { NextRequest, NextResponse } from "next/server";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { Contract, getAddress } from "ethers";
import { isAddress } from "viem";
import {
  getAgentComputeDelegateImplementation,
  getAgentComputeFundingConfig,
  getAgentComputeProvider,
  getAgentComputeWalletSigner,
  hasAgentComputeRootSecret,
  hasAgentComputeRelayerSecret,
} from "@/lib/agent-compute-wallet";
import { checkOnChainAuth, verifyAuthHeader } from "@/lib/auth";
import { COMPUTE_PROVIDERS } from "@/lib/compute-providers";

interface TransferBody {
  providerAddress?: string;
  amountWei?: string;
}

const EIP7702_DELEGATION_PREFIX = "0xef0100";
const LEDGER_SERVICE_ABI = [
  "function getServiceInfo(address serviceAddress) view returns (tuple(address serviceAddress,address serviceContract,string serviceType,string version,string fullName,string description,bool isRecommended,uint256 registeredAt))",
];
const DELEGATE_OWNER_ABI = ["function owner() view returns (address)"];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function formatLedgerBalance(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value ?? "0");
}

function isInsufficientFundsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes("insufficient funds");
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

async function requireAuthorizedAddress(id: string, req: NextRequest) {
  const address = await verifyAuthHeader(id, req.headers.get("Authorization"));
  if (!address) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      address: null,
    };
  }

  const { isAuthorized } = await checkOnChainAuth(id, address);
  if (!isAuthorized) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      address: null,
    };
  }

  return { response: null, address };
}

async function getHostedWalletState(
  tokenId: string,
  userAddress: string,
  providerAddress: string | null
) {
  const { record, signer } = await getAgentComputeWalletSigner(tokenId, userAddress);
  const broker = await createZGComputeNetworkBroker(signer);
  const nativeBalanceWei = (await signer.provider!.getBalance(record.address)).toString();
  const code = await signer.provider!.getCode(record.address);
  const delegatedImplementation = getDelegatedImplementation(code);
  const configuredImplementation = getAgentComputeDelegateImplementation();
  const normalizedImplementation =
    configuredImplementation && isAddress(configuredImplementation)
      ? getAddress(configuredImplementation)
      : null;
  const ownerAddress = delegatedImplementation ? await getDelegateOwner(record.address) : null;
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
  let providerBalances: { address: string; balanceWei: string }[] =
    COMPUTE_PROVIDERS.map((provider) => ({
      address: provider.address,
      balanceWei: "0",
    }));
  if (providerAddress) {
    try {
      const providers = await broker.ledger.getProvidersWithBalance("inference");
      providerBalances = COMPUTE_PROVIDERS.map((knownProvider) => {
        const match = providers.find(
          ([provider]) =>
            provider.toLowerCase() === knownProvider.address.toLowerCase()
        );
        return {
          address: knownProvider.address,
          balanceWei: match?.[1]?.toString() ?? "0",
        };
      });
      const match = providers.find(
        ([provider]) => provider.toLowerCase() === providerAddress.toLowerCase()
      );
      providerBalanceWei = match?.[1]?.toString() ?? "0";
    } catch {
      // No provider sub-account exists yet.
    }
  }

  return {
    wallet: {
      address: record.address,
      nativeBalanceWei,
    },
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuthorizedAddress(id, req);
  if (auth.response) return auth.response;

  if (!hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Hosted compute wallet root is not configured", configured: false },
      { status: 503 }
    );
  }

  const providerAddress = req.nextUrl.searchParams.get("provider");
  try {
    const state = await getHostedWalletState(id, auth.address!, providerAddress);
    return NextResponse.json({ configured: true, ...state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuthorizedAddress(id, req);
  if (auth.response) return auth.response;

  if (!hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Hosted compute wallet root is not configured", configured: false },
      { status: 503 }
    );
  }

  const body = (await req.json()) as TransferBody;
  if (
    !body.providerAddress ||
    !isAddress(body.providerAddress) ||
    !body.amountWei ||
    !/^\d+$/.test(body.amountWei) ||
    BigInt(body.amountWei) <= 0n
  ) {
    return NextResponse.json(
      { error: "valid providerAddress and positive amountWei are required" },
      { status: 400 }
    );
  }

  try {
    const { signer } = await getAgentComputeWalletSigner(id, auth.address!);
    const broker = await createZGComputeNetworkBroker(signer);
    await broker.ledger.transferFund(
      body.providerAddress,
      "inference",
      BigInt(body.amountWei)
    );
    const state = await getHostedWalletState(id, auth.address!, body.providerAddress);
    return NextResponse.json({ configured: true, ...state });
  } catch (err) {
    if (isInsufficientFundsError(err)) {
      const state = await getHostedWalletState(id, auth.address!, body.providerAddress);
      return NextResponse.json(
        {
          configured: true,
          ...state,
          error:
            "Hosted wallet has ledger funds, but needs native 0G for gas before it can fund the provider.",
        },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
