// Server-side hosted compute wallet derivation.
// Database rows store only HD paths and public addresses.

import { prisma } from "@/lib/db";
import { zgTestnet } from "@/lib/chain";
import {
  getAddress,
  getBytes,
  HDNodeWallet,
  isHexString,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes,
  Wallet,
} from "ethers";

const ZG_RPC =
  process.env.NEXT_PUBLIC_ZG_EVM_RPC ??
  process.env.ZG_EVM_RPC ??
  "https://rpc.ankr.com/0g_galileo_testnet_evm";

const DERIVATION_PURPOSE = "opendock-agent-compute-wallet-v1";
const MAX_DERIVATION_ATTEMPTS = 32;
const TESTNET_LEDGER_ADDRESS = "0xE70830508dAc0A97e6c087c75f402f9Be669E406";
const TESTNET_INFERENCE_ADDRESS = "0xa79F4c8311FF93C06b8CfB403690cc987c93F91E";
const TESTNET_DEV_LEDGER_ADDRESS = "0x815B93ab4Ba4BDF530dbF1552649a3c534F8BbF7";
const TESTNET_DEV_INFERENCE_ADDRESS = "0x41bD7Ac5c19000A974D5c192bcd5FB67b56C85c5";

export interface AgentComputeWalletRecord {
  tokenId: string;
  userAddress: string;
  hdPath: string;
  address: string;
}

export interface AgentComputeFundingConfig {
  ledgerAddress: string;
  inferenceAddress: string;
}

export function hasAgentComputeRootSecret(): boolean {
  return Boolean(
    process.env.OPENDOCK_AGENT_WALLET_MNEMONIC ||
      process.env.OPENDOCK_AGENT_MASTER_PRIVATE_KEY
  );
}

export function hasAgentComputeRelayerSecret(): boolean {
  return Boolean(process.env.OPENDOCK_AGENT_RELAYER_PRIVATE_KEY);
}

export function getAgentComputeProvider(): JsonRpcProvider {
  return new JsonRpcProvider(ZG_RPC, zgTestnet.id);
}

export function getAgentComputeFundingConfig(): AgentComputeFundingConfig {
  const isDevMode =
    process.env.ZG_DEV_MODE === "true" ||
    process.env.ZG_DEV_MODE === "1" ||
    process.env.NEXT_PUBLIC_ZG_DEV_MODE === "true" ||
    process.env.NEXT_PUBLIC_ZG_DEV_MODE === "1";

  return {
    ledgerAddress:
      process.env.ZG_COMPUTE_LEDGER_ADDRESS ??
      process.env.NEXT_PUBLIC_ZG_COMPUTE_LEDGER_ADDRESS ??
      (isDevMode ? TESTNET_DEV_LEDGER_ADDRESS : TESTNET_LEDGER_ADDRESS),
    inferenceAddress:
      process.env.ZG_COMPUTE_INFERENCE_ADDRESS ??
      process.env.NEXT_PUBLIC_ZG_COMPUTE_INFERENCE_ADDRESS ??
      (isDevMode ? TESTNET_DEV_INFERENCE_ADDRESS : TESTNET_INFERENCE_ADDRESS),
  };
}

export function getAgentComputeDelegateImplementation(): string | null {
  return (
    process.env.AGENT_COMPUTE_WALLET_DELEGATE_IMPLEMENTATION ??
    process.env.NEXT_PUBLIC_AGENT_COMPUTE_WALLET_DELEGATE_IMPLEMENTATION ??
    null
  );
}

export function getAgentComputeRelayerSigner(): Wallet {
  const privateKey = process.env.OPENDOCK_AGENT_RELAYER_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error(
      "Hosted compute wallet relayer is not configured. Set OPENDOCK_AGENT_RELAYER_PRIVATE_KEY."
    );
  }
  if (!isHexString(privateKey, 32)) {
    throw new Error("OPENDOCK_AGENT_RELAYER_PRIVATE_KEY must be a 32-byte hex private key.");
  }
  return new Wallet(privateKey, getAgentComputeProvider());
}

function getRootHDWallet(): HDNodeWallet {
  const phrase = process.env.OPENDOCK_AGENT_WALLET_MNEMONIC?.trim();
  if (phrase) {
    return HDNodeWallet.fromPhrase(phrase, undefined, "m");
  }

  const privateKey = process.env.OPENDOCK_AGENT_MASTER_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error(
      "Hosted compute wallet root is not configured. Set OPENDOCK_AGENT_WALLET_MNEMONIC or OPENDOCK_AGENT_MASTER_PRIVATE_KEY."
    );
  }
  if (!isHexString(privateKey, 32)) {
    throw new Error("OPENDOCK_AGENT_MASTER_PRIVATE_KEY must be a 32-byte hex private key.");
  }

  // A raw private key is not a BIP-32 extended key. Treat it as root entropy
  // and derive an HD root deterministically from that secret.
  const seed = keccak256(
    new Uint8Array([
      ...getBytes(privateKey),
      ...toUtf8Bytes(DERIVATION_PURPOSE),
    ])
  );
  return HDNodeWallet.fromSeed(seed);
}

function deriveIndex(tokenId: string, normalizedUserAddress: string, attempt: number): number {
  const digest = keccak256(
    toUtf8Bytes(`${DERIVATION_PURPOSE}:${zgTestnet.id}:${tokenId}:${normalizedUserAddress}:${attempt}`)
  );
  return Number(BigInt(digest) & 0x7fffffffn);
}

function deriveWalletAtPath(hdPath: string): HDNodeWallet {
  return getRootHDWallet().derivePath(hdPath);
}

function buildPath(index: number): string {
  return `m/44'/60'/${zgTestnet.id}'/0/${index}`;
}

export async function ensureAgentComputeWallet(
  tokenId: string,
  userAddress: string
): Promise<AgentComputeWalletRecord> {
  const normalizedUserAddress = getAddress(userAddress).toLowerCase();
  const existing = await prisma.agentComputeWallet.findUnique({
    where: { tokenId_userAddress: { tokenId, userAddress: normalizedUserAddress } },
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_DERIVATION_ATTEMPTS; attempt += 1) {
    const hdPath = buildPath(deriveIndex(tokenId, normalizedUserAddress, attempt));
    const address = deriveWalletAtPath(hdPath).address;
    try {
      return await prisma.agentComputeWallet.create({
        data: {
          tokenId,
          userAddress: normalizedUserAddress,
          hdPath,
          address,
        },
      });
    } catch {
      const raced = await prisma.agentComputeWallet.findUnique({
        where: { tokenId_userAddress: { tokenId, userAddress: normalizedUserAddress } },
      });
      if (raced) return raced;
    }
  }

  throw new Error("Unable to allocate a unique hosted compute wallet path.");
}

// All agents for a user share the same hosted wallet keyed by userAddress only.
// The tokenId parameter is kept for API compatibility but is ignored.
export function getAgentComputeWalletSigner(
  _tokenId: string,
  userAddress: string
): { address: string; signer: Wallet } {
  return getUserComputeWalletSigner(userAddress);
}

// User-level (per-wallet) hosted wallet — no agent / tokenId required.
// Derived deterministically from the user address; not persisted to the DB.
export function getUserComputeWalletSigner(
  userAddress: string
): { address: string; signer: Wallet } {
  const normalizedAddress = getAddress(userAddress).toLowerCase();
  const digest = keccak256(
    toUtf8Bytes(`${DERIVATION_PURPOSE}:user:${zgTestnet.id}:${normalizedAddress}`)
  );
  const index = Number(BigInt(digest) & 0x7fffffffn);
  const hdPath = buildPath(index);
  const wallet = deriveWalletAtPath(hdPath);
  const provider = getAgentComputeProvider();
  return { address: wallet.address, signer: new Wallet(wallet.privateKey, provider) };
}
