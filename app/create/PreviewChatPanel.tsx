"use client";

// PreviewChatPanel — lets the agent creator test their agent before deploying.
// Works exactly like the AgentConsole but:
//   - KB files are uploaded to Vercel Blob (date-keyed for easy cleanup)
//   - Chat is NOT stored in the database (session-only, gone on clear/close)
//   - Auth uses a session bearer (no tokenId required)
//   - Wallet uses the user-level platform wallet, same as AgentConsole

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccount, useWalletClient, useBalance } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BrowserProvider, Contract, parseEther } from "ethers";
import { buildSessionAuthMessage } from "@/lib/auth";
import { COMPUTE_PROVIDERS, type ComputeProvider } from "@/lib/compute-providers";
import { MarkdownMessage } from "@/components/MarkdownMessage";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type ComputeWalletMode = "hosted" | "user";

interface HostedWalletState {
  configured: boolean;
  wallet: { address: string; nativeBalanceWei: string };
  delegate: {
    ready: boolean;
    ownerAddress: string | null;
    implementationAddress: string | null;
    currentImplementationAddress: string | null;
    setupAvailable: boolean;
  };
  funding: {
    ledgerAddress: string;
    inferenceAddress: string;
    serviceName: string;
  };
  ledger: {
    hasLedger: boolean;
    totalBalanceWei: string;
    availableBalanceWei: string;
  };
  providerBalanceWei: string;
}

const AGENT_COMPUTE_WALLET_DELEGATE_ABI = [
  "function createLedger(address ledger,string additionalInfo) payable",
  "function depositLedger(address ledger) payable",
  "function fundProvider(address ledger,address provider,string serviceName,uint256 transferAmount)",
  "function depositAndFundProvider(address ledger,address provider,string serviceName,uint256 transferAmount) payable",
] as const;

const SESSION_BEARER_CACHE_MS = 25 * 60 * 1000;

interface CachedBearer {
  address: string;
  bearer: string;
  timestamp: number;
}

async function buildSessionBearer(
  signer: import("ethers").JsonRpcSigner
): Promise<string> {
  const address = await signer.getAddress();
  const cacheKey = `opendock.session-auth.${address.toLowerCase()}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedBearer;
      if (
        parsed.address.toLowerCase() === address.toLowerCase() &&
        Date.now() - parsed.timestamp < SESSION_BEARER_CACHE_MS
      ) {
        return parsed.bearer;
      }
    }
  } catch { /* ignore */ }

  const timestamp = Date.now();
  const message = buildSessionAuthMessage(timestamp);
  const signature = await signer.signMessage(message);
  const payload = { address, timestamp, signature };
  const bearer = "Bearer " + Buffer.from(JSON.stringify(payload)).toString("base64");
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ address, bearer, timestamp } satisfies CachedBearer));
  } catch { /* ignore */ }
  return bearer;
}

function weiToOg(wei: string | bigint | null | undefined): number {
  if (!wei) return 0;
  try { return Number(BigInt(wei)) / 1e18; } catch { return 0; }
}

function ogToWei(amount: number): bigint {
  return BigInt(Math.round(amount * 1e18));
}

// ---- Ledger Panel ----
function LedgerPanel({
  balance, providerBalance, hasLedger, loading,
  onDeposit, onTransfer, onSetupDelegate,
  providerAddress, mode, walletAddress,
  delegateReady, delegateSetupAvailable,
}: {
  balance: number | null;
  providerBalance: number | null;
  hasLedger: boolean | null;
  loading: boolean;
  onDeposit: (amount: number) => void;
  onTransfer: (provider: string, amount: number) => void;
  onSetupDelegate: () => void;
  providerAddress: string;
  mode: ComputeWalletMode;
  walletAddress: string | null;
  delegateReady: boolean | null;
  delegateSetupAvailable: boolean;
}) {
  const [depositAmt, setDepositAmt] = useState("3");
  const [transferAmt, setTransferAmt] = useState("1");
  const needsHostedSetup = mode === "hosted" && delegateReady === false;

  if (hasLedger === null) {
    return (
      <div className="bg-surface-container-low rounded-xl p-md flex items-center gap-sm text-outline">
        <span className="inline-block w-4 h-4 border-2 border-outline/30 border-t-outline rounded-full animate-spin" />
        <span className="font-body-sub text-body-sub">Checking ledger…</span>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-md flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 18 }}>
            account_balance_wallet
          </span>
          <span className="font-semibold text-amber-800 font-body-main text-body-main">
            0G Compute Ledger
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-data-mono text-data-mono font-bold text-amber-900">
            {balance !== null ? `${balance.toFixed(4)} OG` : "—"}
          </span>
          <span className="font-data-mono text-[10px] text-amber-700">
            Provider {providerBalance !== null ? `${providerBalance.toFixed(4)} OG` : "—"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-sm text-[11px] text-amber-700 font-data-mono">
        <span>{mode === "hosted" ? "Platform wallet" : "Your wallet"}</span>
        {walletAddress && (
          <span className="truncate">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
        )}
      </div>

      {needsHostedSetup && (
        <div className="bg-white/70 border border-amber-300 rounded-lg px-sm py-xs flex items-center gap-sm flex-wrap">
          <span className="text-amber-800 text-xs font-semibold">
            Enable hosted wallet before funding ledger/provider.
          </span>
          <button
            onClick={onSetupDelegate}
            disabled={loading || !delegateSetupAvailable}
            className="bg-amber-700 text-white font-label-caps text-label-caps font-semibold py-xs px-sm rounded-full hover:bg-amber-800 transition-colors disabled:opacity-50 text-xs flex items-center gap-xs"
          >
            {loading && <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Enable Hosted Wallet
          </button>
          {!delegateSetupAvailable && (
            <span className="text-amber-700 text-xs">Server relayer/delegate env is not configured.</span>
          )}
        </div>
      )}

      {!hasLedger ? (
        <>
          <p className="font-body-sub text-body-sub text-amber-700 text-xs">
            Create a ledger to start using 0G Compute. Min deposit: 3 OG.
            {mode === "hosted" ? " Your wallet pays the tx; the ledger belongs to the hosted wallet." : ""}
          </p>
          <div className="flex gap-sm items-center">
            <input
              type="number" min="3" step="1" value={depositAmt}
              onChange={(e) => setDepositAmt(e.target.value)}
              className="bg-white border border-amber-300 rounded-lg px-sm py-xs font-data-mono text-data-mono w-24 focus:outline-none focus:border-amber-500"
            />
            <span className="text-amber-700 text-sm">OG</span>
            <button
              onClick={() => onDeposit(parseFloat(depositAmt))}
              disabled={loading || needsHostedSetup}
              className="bg-amber-600 text-white font-label-caps text-label-caps font-semibold py-xs px-md rounded-full hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-xs"
            >
              {loading && <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              Create Ledger
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-body-sub text-body-sub text-amber-600 text-xs">
            Fund this provider sub-account to send queries (min 1 OG).
          </p>
          <div className="flex gap-sm items-center flex-wrap">
            <div className="flex gap-sm items-center">
              <span className="text-amber-700 text-xs font-semibold">Top-up ledger:</span>
              <input
                type="number" min="1" step="1" value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                className="bg-white border border-amber-300 rounded-lg px-sm py-xs font-data-mono text-data-mono w-20 focus:outline-none focus:border-amber-500"
              />
              <span className="text-amber-700 text-xs">OG</span>
              <button
                onClick={() => onDeposit(parseFloat(depositAmt))} disabled={loading || needsHostedSetup}
                className="bg-amber-100 text-amber-800 border border-amber-400 font-label-caps text-label-caps font-semibold py-xs px-sm rounded-full hover:bg-amber-200 transition-colors disabled:opacity-50 text-xs"
              >Deposit</button>
            </div>
            <div className="flex gap-sm items-center">
              <span className="text-amber-700 text-xs font-semibold">Fund provider:</span>
              <input
                type="number" min="1" step="1" value={transferAmt}
                onChange={(e) => setTransferAmt(e.target.value)}
                className="bg-white border border-amber-300 rounded-lg px-sm py-xs font-data-mono text-data-mono w-20 focus:outline-none focus:border-amber-500"
              />
              <span className="text-amber-700 text-xs">OG</span>
              <button
                onClick={() => onTransfer(providerAddress, parseFloat(transferAmt))} disabled={loading || needsHostedSetup}
                className="bg-amber-600 text-white font-label-caps text-label-caps font-semibold py-xs px-sm rounded-full hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-xs text-xs"
              >
                {loading && <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {needsHostedSetup ? "Enable First" : "Transfer"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Main Panel ----
export interface PreviewChatPanelProps {
  systemPrompt: string;
  kbFiles: File[];
}

export default function PreviewChatPanel({ systemPrompt, kbFiles }: PreviewChatPanelProps) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { data: balanceData } = useBalance({ address });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // KB blobs — null until first message is sent (snapshot of kbFiles at that point)
  const [kbBlobUrls, setKbBlobUrls] = useState<{ name: string; url: string }[] | null>(null);
  const [uploadingKb, setUploadingKb] = useState(false);
  // Track which kbFiles were used for the current blob snapshot
  const activeBlobsRef = useRef<{ name: string; url: string }[] | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<ComputeProvider>(COMPUTE_PROVIDERS[0]);
  const [computeWalletMode, setComputeWalletMode] = useState<ComputeWalletMode>("hosted");

  const [ledgerBalance, setLedgerBalance] = useState<number | null>(null);
  const [providerBalance, setProviderBalance] = useState<number | null>(null);
  const [hasLedger, setHasLedger] = useState<boolean | null>(null);
  const [hostedWalletAddress, setHostedWalletAddress] = useState<string | null>(null);
  const [hostedNativeBalance, setHostedNativeBalance] = useState<number | null>(null);
  const [hostedDelegateReady, setHostedDelegateReady] = useState<boolean | null>(null);
  const [hostedDelegateSetupAvailable, setHostedDelegateSetupAvailable] = useState(false);
  const [hostedFundingConfig, setHostedFundingConfig] = useState<HostedWalletState["funding"] | null>(null);
  const [fundLoading, setFundLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Cleanup blobs on unmount
  useEffect(() => {
    return () => {
      const blobs = activeBlobsRef.current;
      if (blobs?.length) {
        const urls = blobs.map((b) => b.url);
        // Fire-and-forget — best effort on unmount
        fetch("/api/preview/delete-kb", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
          keepalive: true,
        }).catch(() => { /* ignore */ });
      }
    };
  }, []);

  const getSigner = useCallback(async () => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const provider = new BrowserProvider(walletClient.transport);
    return provider.getSigner();
  }, [walletClient, address]);

  const getBroker = useCallback(async () => {
    const signer = await getSigner();
    const { createZGComputeNetworkBroker } = await import("@0glabs/0g-serving-broker");
    return createZGComputeNetworkBroker(signer);
  }, [getSigner]);

  const getBearer = useCallback(async () => {
    const signer = await getSigner();
    return buildSessionBearer(signer);
  }, [getSigner]);

  const refreshLedger = useCallback(async () => {
    if (!isConnected || !address) return;
    try {
      if (computeWalletMode === "hosted") {
        const res = await fetch(
          `/api/wallet/compute-wallet?address=${encodeURIComponent(address)}&provider=${encodeURIComponent(selectedProvider.address)}`
        );
        const data = (await res.json().catch(() => null)) as (HostedWalletState & { error?: string }) | null;
        if (!res.ok || !data) throw new Error(data?.error ?? "Hosted wallet not available");
        setHostedWalletAddress(data.wallet.address);
        setHostedNativeBalance(weiToOg(data.wallet.nativeBalanceWei));
        setHostedDelegateReady(data.delegate.ready);
        setHostedDelegateSetupAvailable(data.delegate.setupAvailable);
        setHostedFundingConfig(data.funding);
        setLedgerBalance(weiToOg(data.ledger.availableBalanceWei));
        setProviderBalance(weiToOg(data.providerBalanceWei));
        setHasLedger(data.ledger.hasLedger);
      } else {
        setHostedWalletAddress(null);
        setHostedNativeBalance(null);
        setHostedDelegateReady(null);
        setHostedDelegateSetupAvailable(false);
        setHostedFundingConfig(null);
        const broker = await getBroker();
        const info = await broker.ledger.getLedger();
        if (info) {
          setLedgerBalance(Number(BigInt(String(info.availableBalance))) / 1e18);
          setHasLedger(true);
        } else {
          setLedgerBalance(0);
          setHasLedger(false);
        }
        try {
          const providers = await broker.ledger.getProvidersWithBalance("inference");
          const match = providers.find(
            ([p]) => p.toLowerCase() === selectedProvider.address.toLowerCase()
          );
          setProviderBalance(weiToOg(match?.[1]?.toString()));
        } catch {
          setProviderBalance(0);
        }
      }
    } catch (err) {
      setLedgerBalance(0);
      setProviderBalance(0);
      setHasLedger(false);
      if (computeWalletMode === "hosted") {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [address, computeWalletMode, getBroker, isConnected, selectedProvider.address]);

  useEffect(() => {
    queueMicrotask(() => { void refreshLedger(); });
  }, [refreshLedger]);

  const handleSetupHostedWallet = useCallback(async () => {
    if (fundLoading || computeWalletMode !== "hosted") return;
    setFundLoading(true);
    setError(null);
    try {
      const bearer = await getBearer();
      const res = await fetch("/api/wallet/compute-wallet/setup", {
        method: "POST",
        headers: { Authorization: bearer },
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<HostedWalletState> & { error?: string })
        | null;
      if (!res.ok || !data) throw new Error(data?.error ?? "Hosted wallet setup failed");
      if (data.wallet?.address) setHostedWalletAddress(data.wallet.address);
      if (data.delegate) {
        setHostedDelegateReady(data.delegate.ready ?? false);
        setHostedDelegateSetupAvailable(data.delegate.setupAvailable ?? false);
      }
      if (data.funding) setHostedFundingConfig(data.funding);
      await refreshLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFundLoading(false);
    }
  }, [computeWalletMode, fundLoading, getBearer, refreshLedger]);

  const handleDeposit = useCallback(async (amount: number) => {
    setFundLoading(true);
    setError(null);
    try {
      if (computeWalletMode === "hosted") {
        if (!hostedWalletAddress) throw new Error("Hosted wallet not ready");
        if (!hostedDelegateReady || !hostedFundingConfig) throw new Error("Enable hosted wallet first.");
        const signer = await getSigner();
        const delegate = new Contract(hostedWalletAddress, AGENT_COMPUTE_WALLET_DELEGATE_ABI, signer);
        const value = parseEther(String(amount));
        const tx = hasLedger
          ? await delegate.depositLedger(hostedFundingConfig.ledgerAddress, { value })
          : await delegate.createLedger(hostedFundingConfig.ledgerAddress, "opendock", { value });
        await tx.wait();
      } else {
        const broker = await getBroker();
        await broker.ledger.depositFund(amount);
      }
      await refreshLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFundLoading(false);
    }
  }, [computeWalletMode, getBroker, getSigner, hasLedger, hostedDelegateReady, hostedFundingConfig, hostedWalletAddress, refreshLedger]);

  const handleTransfer = useCallback(async (providerAddr: string, amount: number) => {
    if (fundLoading) return;
    setFundLoading(true);
    setError(null);
    try {
      if (computeWalletMode === "hosted") {
        if (!hostedWalletAddress) throw new Error("Hosted wallet not ready");
        if (!hostedDelegateReady || !hostedFundingConfig) throw new Error("Enable hosted wallet first.");
        if (!hasLedger) throw new Error("Create the hosted wallet ledger first.");
        const signer = await getSigner();
        const delegate = new Contract(hostedWalletAddress, AGENT_COMPUTE_WALLET_DELEGATE_ABI, signer);
        const tx = await delegate.fundProvider(
          hostedFundingConfig.ledgerAddress,
          providerAddr,
          hostedFundingConfig.serviceName,
          ogToWei(amount)
        );
        await tx.wait();
      } else {
        const broker = await getBroker();
        await broker.ledger.transferFund(providerAddr, "inference", ogToWei(amount));
      }
      await refreshLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFundLoading(false);
    }
  }, [computeWalletMode, fundLoading, getBroker, getSigner, hasLedger, hostedDelegateReady, hostedFundingConfig, hostedWalletAddress, refreshLedger]);

  // Upload KB files snapshot to Vercel Blob (called once per test session).
  const ensureKbUploaded = useCallback(async (): Promise<{ name: string; url: string }[]> => {
    if (kbBlobUrls !== null) return kbBlobUrls;
    if (!kbFiles.length) {
      setKbBlobUrls([]);
      activeBlobsRef.current = [];
      return [];
    }
    setUploadingKb(true);
    try {
      const bearer = await getBearer();
      const formData = new FormData();
      for (const f of kbFiles) formData.append("files", f);
      const res = await fetch("/api/preview/upload-kb", {
        method: "POST",
        headers: { Authorization: bearer },
        body: formData,
      });
      const data = (await res.json().catch(() => null)) as { files?: { name: string; url: string }[]; error?: string } | null;
      if (!res.ok || !data) throw new Error(data?.error ?? "KB upload failed");
      const uploaded = data.files ?? [];
      setKbBlobUrls(uploaded);
      activeBlobsRef.current = uploaded;
      return uploaded;
    } finally {
      setUploadingKb(false);
    }
  }, [getBearer, kbBlobUrls, kbFiles]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending || !address) return;
    const query = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    const newMessages: Message[] = [...messages, { role: "user", content: query }];
    setMessages(newMessages);

    try {
      const uploadedKb = await ensureKbUploaded();
      const bearer = await getBearer();
      const broker = computeWalletMode === "user" ? await getBroker() : null;
      const servingHeaders =
        computeWalletMode === "user"
          ? await broker!.inference.getRequestHeaders(selectedProvider.address)
          : null;

      const res = await fetch("/api/preview/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: bearer },
        body: JSON.stringify({
          systemPrompt,
          kbFiles: uploadedKb,
          providerAddress: selectedProvider.address,
          walletMode: computeWalletMode,
          servingHeaders,
          messages: newMessages,
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        content?: string;
        chatID?: string | null;
        usage?: unknown;
        error?: string;
      } | null;

      if (!res.ok) throw new Error(data?.error ?? "0G Compute request failed");

      const content = data?.content ?? "";
      if (computeWalletMode === "user" && data?.chatID && broker) {
        await broker.inference.processResponse(
          selectedProvider.address,
          data.chatID,
          data.usage ? JSON.stringify(data.usage) : undefined
        );
      }

      setMessages([...newMessages, { role: "assistant", content }]);
      await refreshLedger();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages([...newMessages, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setSending(false);
    }
  }, [
    address, computeWalletMode, ensureKbUploaded, getBroker, getBearer,
    input, messages, refreshLedger, selectedProvider.address, sending, systemPrompt,
  ]);

  const handleClear = useCallback(async () => {
    setMessages([]);
    setError(null);
    setInput("");

    const blobs = activeBlobsRef.current;
    if (blobs?.length) {
      activeBlobsRef.current = null;
      setKbBlobUrls(null);
      try {
        const bearer = await getBearer();
        await fetch("/api/preview/delete-kb", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: bearer },
          body: JSON.stringify({ urls: blobs.map((b) => b.url) }),
        });
      } catch { /* ignore */ }
    } else {
      setKbBlobUrls(null);
      activeBlobsRef.current = null;
    }
  }, [getBearer]);

  if (!isConnected) {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
        <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>chat</span>
        <p className="font-body-main text-body-main text-on-surface-variant text-center">
          Connect your wallet to test your agent
        </p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-[0px_4px_20px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-md px-lg py-md border-b border-outline-variant/30 flex-wrap">
        <div className="flex items-center gap-sm min-w-0">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="font-label-caps text-label-caps font-semibold text-on-surface">
            Test Agent
          </span>
          <span className="text-xs font-label-caps text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-sm py-xs">
            Preview
          </span>
        </div>
        <div className="flex items-center gap-sm flex-wrap justify-end">
          {balanceData && (
            <span className="font-data-mono text-data-mono text-on-surface-variant text-xs">
              {(Number(balanceData.value) / 1e18).toFixed(4)} {balanceData.symbol}
            </span>
          )}
          <select
            value={selectedProvider.address}
            onChange={(e) => {
              setSelectedProvider(COMPUTE_PROVIDERS.find((p) => p.address === e.target.value) ?? COMPUTE_PROVIDERS[0]);
              setLedgerBalance(null);
              setProviderBalance(null);
              setHasLedger(null);
            }}
            className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs text-sm text-on-surface focus:outline-none focus:border-primary"
          >
            {COMPUTE_PROVIDERS.map((p) => (
              <option key={p.address} value={p.address}>{p.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleClear}
            title="Clear conversation"
            disabled={messages.length === 0 && !kbBlobUrls?.length}
            className="flex items-center gap-xs px-sm py-xs rounded-lg border border-outline-variant text-on-surface-variant text-xs hover:border-error hover:text-error transition-colors disabled:opacity-40"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restart_alt</span>
            Clear
          </button>
        </div>
      </div>

      {/* Wallet mode toggle */}
      <div className="px-lg pt-md">
        <div className="bg-surface-container rounded-xl border border-outline-variant/40 p-md flex flex-col sm:flex-row sm:items-center justify-between gap-sm">
          <div className="flex flex-col gap-xs min-w-0">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">Platform wallet</span>
            <span className="font-body-sub text-body-sub text-on-surface-variant text-xs">
              {computeWalletMode === "hosted"
                ? "Platform-hosted wallet. Server enables it once; your wallet funds ledger/provider transactions directly."
                : "Your connected wallet signs 0G Compute requests directly."}
            </span>
          </div>
          <label className="flex items-center gap-sm cursor-pointer select-none shrink-0">
            <span className={`text-xs font-semibold ${computeWalletMode === "hosted" ? "text-on-surface" : "text-outline"}`}>
              Platform
            </span>
            <input
              type="checkbox"
              checked={computeWalletMode === "user"}
              onChange={(e) => {
                setComputeWalletMode(e.target.checked ? "user" : "hosted");
                setLedgerBalance(null);
                setProviderBalance(null);
                setHasLedger(null);
                setHostedNativeBalance(null);
                setHostedDelegateReady(null);
                setHostedDelegateSetupAvailable(false);
                setHostedFundingConfig(null);
                setError(null);
              }}
              className="sr-only"
            />
            <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${computeWalletMode === "user" ? "bg-primary" : "bg-outline-variant"}`}>
              <span className={`block w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${computeWalletMode === "user" ? "translate-x-5" : "translate-x-0"}`} />
            </span>
            <span className={`text-xs font-semibold ${computeWalletMode === "user" ? "text-on-surface" : "text-outline"}`}>
              Mine
            </span>
          </label>
        </div>
      </div>

      {/* Ledger panel */}
      <div className="px-lg pt-md">
        <LedgerPanel
          balance={ledgerBalance}
          providerBalance={providerBalance}
          hasLedger={hasLedger}
          loading={fundLoading}
          onDeposit={handleDeposit}
          onTransfer={handleTransfer}
          onSetupDelegate={handleSetupHostedWallet}
          providerAddress={selectedProvider.address}
          mode={computeWalletMode}
          walletAddress={computeWalletMode === "hosted" ? hostedWalletAddress : address ?? null}
          delegateReady={computeWalletMode === "hosted" ? hostedDelegateReady : true}
          delegateSetupAvailable={hostedDelegateSetupAvailable}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md min-h-[300px] max-h-[480px]">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-sm text-outline">
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>smart_toy</span>
            <p className="font-body-sub text-body-sub text-center">
              Send a message to test your agent configuration
            </p>
            <p className="font-body-sub text-body-sub text-center text-xs text-outline/70">
              {kbFiles.length > 0
                ? `KB files will be uploaded on first message (${kbFiles.length} file${kbFiles.length > 1 ? "s" : ""})`
                : "No KB files attached — only system prompt will be used"}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-md py-sm font-body-main text-body-main leading-relaxed ${
              m.role === "user"
                ? "bg-primary text-on-primary rounded-br-sm whitespace-pre-wrap"
                : "bg-surface-container text-on-surface rounded-bl-sm"
            }`}>
              {m.role === "assistant" ? <MarkdownMessage content={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {(sending || uploadingKb) && (
          <div className="flex justify-start">
            <div className="bg-surface-container rounded-2xl rounded-bl-sm px-md py-sm flex items-center gap-xs">
              {uploadingKb
                ? <span className="text-xs text-outline">Uploading KB files…</span>
                : [0, 150, 300].map((d) => (
                    <span key={d} className="w-2 h-2 bg-outline rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))
              }
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-lg mb-sm bg-red-50 border border-red-200 rounded-lg px-md py-sm">
          <p className="font-body-sub text-body-sub text-red-600 break-all">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-red-400 underline mt-xs">Dismiss</button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-outline-variant/30 px-lg py-md flex gap-sm items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
          placeholder={
            hasLedger === false
              ? "Create a ledger above to start chatting"
              : providerBalance === 0
              ? "Fund the provider above to start chatting"
              : "Type a message… (Enter to send)"
          }
          rows={1}
          disabled={sending || uploadingKb || hasLedger === false || providerBalance === 0}
          className="flex-1 bg-surface-container rounded-xl px-md py-sm font-body-main text-body-main text-on-surface placeholder:text-outline resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 border border-outline-variant disabled:opacity-50 max-h-32 overflow-y-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          onClick={() => void sendMessage()}
          disabled={sending || uploadingKb || !input.trim() || hasLedger === false || providerBalance === 0}
          className="bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {sending || uploadingKb
            ? <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
            : <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
          }
        </button>
      </div>
    </div>
  );
}
