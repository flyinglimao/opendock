// Auth-gated EIP-7702 setup for the user-level (per-wallet) platform wallet.

import { NextRequest, NextResponse } from "next/server";
import { Contract, getAddress, Interface, isAddress } from "ethers";
import {
  getAgentComputeDelegateImplementation,
  getAgentComputeFundingConfig,
  getAgentComputeProvider,
  getAgentComputeRelayerSigner,
  getUserComputeWalletSigner,
  hasAgentComputeRelayerSecret,
  hasAgentComputeRootSecret,
} from "@/lib/agent-compute-wallet";
import { zgTestnet } from "@/lib/chain";
import { verifyAuthHeader } from "@/lib/auth";

const EIP7702_DELEGATION_PREFIX = "0xef0100";
const LEDGER_SERVICE_ABI = [
  "function getServiceInfo(address serviceAddress) view returns (tuple(address serviceAddress,address serviceContract,string serviceType,string version,string fullName,string description,bool isRecommended,uint256 registeredAt))",
];
const DELEGATE_SETUP_ABI = [
  "function initializeOwner(address initialOwner)",
  "function owner() view returns (address)",
];
const DELEGATE_SETUP_IFACE = new Interface(DELEGATE_SETUP_ABI);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
    const delegate = new Contract(address, DELEGATE_SETUP_ABI, provider);
    const value = String(await delegate.owner());
    return value === ZERO_ADDRESS ? null : getAddress(value);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // verifyAuthHeader accepts session-signed bearers (no tokenId needed).
  const authHeader = req.headers.get("Authorization");
  const recoveredAddress = await verifyAuthHeader("wallet", authHeader);
  if (!recoveredAddress) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userAddress = getAddress(recoveredAddress);

  if (!hasAgentComputeRootSecret()) {
    return NextResponse.json(
      { error: "Platform wallet root is not configured", configured: false },
      { status: 503 }
    );
  }

  const implementation = getAgentComputeDelegateImplementation();
  if (!implementation || !isAddress(implementation)) {
    return NextResponse.json(
      {
        error:
          "Platform wallet delegate is not configured. Set AGENT_COMPUTE_WALLET_DELEGATE_IMPLEMENTATION.",
      },
      { status: 503 }
    );
  }

  if (!hasAgentComputeRelayerSecret()) {
    return NextResponse.json(
      {
        error:
          "Platform wallet relayer is not configured. Set OPENDOCK_AGENT_RELAYER_PRIVATE_KEY.",
      },
      { status: 503 }
    );
  }

  try {
    const normalizedImplementation = getAddress(implementation);
    const { address: walletAddress, signer: hostedSigner } = getUserComputeWalletSigner(userAddress);
    const provider = getAgentComputeProvider();
    const code = await provider.getCode(walletAddress);
    const delegatedImplementation = getDelegatedImplementation(code);
    const serviceName = await getInferenceServiceName();
    const funding = getAgentComputeFundingConfig();
    const expectedOwner = userAddress;

    if (
      delegatedImplementation?.toLowerCase() === normalizedImplementation.toLowerCase()
    ) {
      const currentOwner = await getDelegateOwner(walletAddress);
      const ownerReady = currentOwner?.toLowerCase() === expectedOwner.toLowerCase();
      if (!ownerReady && currentOwner) {
        return NextResponse.json(
          {
            error: `Hosted wallet is already initialized for ${currentOwner}.`,
            delegate: {
              ready: false,
              ownerAddress: currentOwner,
              implementationAddress: normalizedImplementation,
              currentImplementationAddress: delegatedImplementation,
              setupAvailable: true,
            },
          },
          { status: 409 }
        );
      }

      if (!ownerReady) {
        const relayer = getAgentComputeRelayerSigner();
        const tx = await relayer.sendTransaction({
          to: walletAddress,
          data: DELEGATE_SETUP_IFACE.encodeFunctionData("initializeOwner", [expectedOwner]),
          gasLimit: 120000n,
        });
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) {
          throw new Error("Hosted wallet owner initialization failed.");
        }
      }

      return NextResponse.json({
        configured: true,
        wallet: { address: walletAddress },
        delegate: {
          ready: true,
          ownerAddress: expectedOwner,
          implementationAddress: normalizedImplementation,
          currentImplementationAddress: delegatedImplementation,
          setupAvailable: true,
        },
        funding: { ...funding, serviceName },
      });
    }

    if (delegatedImplementation) {
      return NextResponse.json(
        {
          error: `Hosted wallet is already delegated to ${delegatedImplementation}.`,
          delegate: {
            ready: false,
            implementationAddress: normalizedImplementation,
            currentImplementationAddress: delegatedImplementation,
            setupAvailable: true,
          },
        },
        { status: 409 }
      );
    }

    const relayer = getAgentComputeRelayerSigner();
    const authorization = await hostedSigner.authorize({
      address: normalizedImplementation,
      chainId: BigInt(zgTestnet.id),
    });
    const tx = await relayer.sendTransaction({
      type: 4,
      to: walletAddress,
      value: 0n,
      data: DELEGATE_SETUP_IFACE.encodeFunctionData("initializeOwner", [expectedOwner]),
      authorizationList: [authorization],
      gasLimit: 120000n,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("EIP-7702 setup transaction failed.");
    }

    return NextResponse.json({
      configured: true,
      wallet: { address: walletAddress },
      delegate: {
        ready: true,
        ownerAddress: expectedOwner,
        implementationAddress: normalizedImplementation,
        currentImplementationAddress: normalizedImplementation,
        setupAvailable: true,
        setupTxHash: tx.hash,
      },
      funding: { ...funding, serviceName },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
