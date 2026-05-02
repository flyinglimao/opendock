"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useConfig, useWalletClient } from "wagmi";
import type { Config } from "wagmi";
import { BrowserProvider, Contract, parseEther } from "ethers";
import { buildSessionAuthMessage } from "@/lib/auth";
import { COMPUTE_PROVIDERS } from "@/lib/compute-providers";

type FundsTab = "ledger" | "providers";
type AuthSessionStatus = "checking" | "ready" | "needed" | "signing";

interface DashboardAgent {
  tokenId: string;
  name: string | null;
  description: string | null;
  image: string | null;
  metadataReady: boolean;
  owner: string | null;
  rentOrderId: string | null;
  rentPricePerSecond: string | null;
  rentMaxDuration: number | null;
  activeRental: boolean;
}

interface DashboardAgentsResponse {
  owned: DashboardAgent[];
  rented: DashboardAgent[];
  error?: string;
}

interface WalletLedgerState {
  hasLedger: boolean;
  availableBalanceWei: string;
  providerBalances: Record<string, string>;
}

interface HostedComputeWalletState {
  configured: boolean;
  wallet: { address: string; nativeBalanceWei: string };
  delegate: {
    ready: boolean;
    ownerAddress: string | null;
    implementationAddress: string | null;
    currentImplementationAddress: string | null;
    setupAvailable: boolean;
    setupTxHash?: string;
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
  providerBalances?: { address: string; balanceWei: string }[];
  error?: string;
}

const DELEGATE_ABI = [
  "function createLedger(address ledger,string additionalInfo) payable",
  "function depositLedger(address ledger) payable",
  "function fundProvider(address ledger,address provider,string serviceName,uint256 transferAmount)",
  "function retrieveProviderFund(address ledger,address provider,string serviceName)",
  "function refundLedgerToOwner(address ledger,uint256 amount)",
] as const;

const AUTH_BEARER_CACHE_MS = 25 * 60 * 1000;
const emptySubscribe = () => () => {};

interface CachedAuthSession {
  address: string;
  bearer: string;
  timestamp: number;
}

interface WagmiPersistControls {
  hasHydrated: () => boolean;
  onHydrate: (listener: () => void) => () => void;
  onFinishHydration: (listener: () => void) => () => void;
}

function getWagmiPersist(config: Config): WagmiPersistControls | null {
  const store = config._internal.store as unknown as { persist?: WagmiPersistControls };
  return store.persist ?? null;
}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function useWagmiStoreHydrated() {
  const config = useConfig();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const persist = getWagmiPersist(config);
      const unsubscribeStatus = config.subscribe((state) => state.status, onStoreChange);
      const unsubscribeHydrate = persist?.onHydrate(onStoreChange) ?? emptySubscribe();
      const unsubscribeFinishHydration =
        persist?.onFinishHydration(onStoreChange) ?? emptySubscribe();

      return () => {
        unsubscribeStatus();
        unsubscribeHydrate();
        unsubscribeFinishHydration();
      };
    },
    [config]
  );

  return useSyncExternalStore(
    subscribe,
    () => !config._internal.ssr || (getWagmiPersist(config)?.hasHydrated() ?? true),
    () => false
  );
}

function weiToOg(wei: string | bigint | null | undefined): number {
  if (!wei) return 0;
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

function ogToWei(amount: number): bigint {
  return BigInt(Math.round(amount * 1e18));
}

function formatOg(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })} OG`;
}

function shortAddress(address: string | null | undefined): string {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getAuthSessionKey(address: string) {
  return `opendock.auth.session.${address.toLowerCase()}`;
}

function isAuthSessionFresh(session: CachedAuthSession, address: string) {
  return (
    session.address.toLowerCase() === address.toLowerCase() &&
    Date.now() - session.timestamp < AUTH_BEARER_CACHE_MS
  );
}

function readCachedAuthSession(address: string): CachedAuthSession | null {
  try {
    const cached = sessionStorage.getItem(getAuthSessionKey(address));
    if (!cached) return null;
    const session = JSON.parse(cached) as CachedAuthSession;
    return isAuthSessionFresh(session, address) ? session : null;
  } catch {
    return null;
  }
}

async function createAuthSession(
  signer: import("ethers").JsonRpcSigner
): Promise<CachedAuthSession> {
  const address = await signer.getAddress();
  const timestamp = Date.now();
  const signature = await signer.signMessage(buildSessionAuthMessage(timestamp));
  const bearer = `Bearer ${window.btoa(JSON.stringify({ address, timestamp, signature }))}`;
  const session = { address, bearer, timestamp };
  try {
    sessionStorage.setItem(getAuthSessionKey(address), JSON.stringify(session));
  } catch {}
  return session;
}

function AgentCard({
  agent,
  kind,
  selected,
  onSelect,
}: {
  agent: DashboardAgent;
  kind: "owned" | "rented";
  selected: boolean;
  onSelect: () => void;
}) {
  const displayName = agent.name ?? `Agent #${agent.tokenId}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`bg-surface-container-lowest rounded-lg border text-left overflow-hidden transition-all hover:border-primary/60 ${
        selected
          ? "border-primary shadow-[0px_8px_28px_rgba(53,37,205,0.12)]"
          : "border-outline-variant/40 shadow-[0px_4px_20px_rgba(0,0,0,0.04)]"
      }`}
    >
      <div className="h-24 bg-surface-container-low relative overflow-hidden">
        {agent.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={agent.image} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-outline" style={{ fontSize: 36 }}>
              smart_toy
            </span>
          </div>
        )}
        <span
          className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            kind === "owned"
              ? "bg-primary text-on-primary"
              : "bg-green-50 text-green-700 border border-green-200"
          }`}
        >
          {kind === "owned" ? "Owned" : "Rented"}
        </span>
        {agent.activeRental && (
          <span className="absolute top-2 right-2 rounded-full bg-white/90 border border-outline-variant px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
            Active
          </span>
        )}
      </div>
      <div className="p-md flex flex-col gap-xs min-h-32">
        <div className="flex items-start justify-between gap-sm">
          <h2 className="font-h2 text-base font-semibold text-on-surface truncate">
            {displayName}
          </h2>
          <span className="font-data-mono text-xs text-outline">#{agent.tokenId}</span>
        </div>
        {agent.description ? (
          <p className="text-xs text-on-surface-variant line-clamp-2">
            {agent.description}
          </p>
        ) : (
          <p className="text-xs text-outline">
            {agent.metadataReady ? "No description" : "Metadata syncing"}
          </p>
        )}
        <Link
          href={`/agents/${agent.tokenId}`}
          className="mt-auto w-fit text-xs font-semibold text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          Open agent
        </Link>
      </div>
    </button>
  );
}

function AmountInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="number"
      min="0"
      step="0.001"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-24 rounded-md border border-outline-variant bg-white px-sm py-xs font-data-mono text-xs text-on-surface focus:outline-none focus:border-primary"
    />
  );
}

export default function DashboardTabs() {
  const hydrated = useHydrated();
  const wagmiStoreHydrated = useWagmiStoreHydrated();
  const { address, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { data: nativeBalance } = useBalance({ address });
  const [agents, setAgents] = useState<{ owned: DashboardAgent[]; rented: DashboardAgent[] }>({
    owned: [],
    rented: [],
  });
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [fundsTab, setFundsTab] = useState<FundsTab>("providers");
  const [walletLedger, setWalletLedger] = useState<WalletLedgerState | null>(null);
  const [cloudState, setCloudState] = useState<HostedComputeWalletState | null>(null);
  const [authSession, setAuthSession] = useState<CachedAuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthSessionStatus>("checking");
  const [fundLoading, setFundLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const firstLoadRef = useRef(false);
  const accountReady = hydrated && Boolean(address);
  const walletChecking =
    !hydrated ||
    !wagmiStoreHydrated ||
    status === "connecting" ||
    status === "reconnecting";

  const allAgents = useMemo(
    () => [...agents.owned, ...agents.rented],
    [agents.owned, agents.rented]
  );
  const selectedAgent =
    allAgents.find((agent) => agent.tokenId === selectedAgentId) ?? allAgents[0] ?? null;
  const walletNativeOg = nativeBalance ? Number(nativeBalance.value) / 1e18 : 0;
  const walletLedgerOg = weiToOg(walletLedger?.availableBalanceWei);
  const cloudLedgerOg = weiToOg(cloudState?.ledger.availableBalanceWei);
  const totalOg = walletNativeOg + cloudLedgerOg;

  const setAmount = useCallback((key: string, value: string) => {
    setAmounts((current) => ({ ...current, [key]: value }));
  }, []);

  const getAmount = useCallback(
    (key: string, fallback = "1") => amounts[key] ?? fallback,
    [amounts]
  );

  const getSigner = useCallback(async () => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    return new BrowserProvider(walletClient.transport).getSigner();
  }, [address, walletClient]);

  const getBroker = useCallback(async () => {
    const signer = await getSigner();
    const { createZGComputeNetworkBroker } = await import("@0glabs/0g-serving-broker");
    return createZGComputeNetworkBroker(signer);
  }, [getSigner]);

  const signIn = useCallback(async () => {
    if (!address || !walletClient) return null;
    setAuthStatus("signing");
    setError(null);
    try {
      const signer = await getSigner();
      const session = await createAuthSession(signer);
      setAuthSession(session);
      setAuthStatus("ready");
      return session;
    } catch (err) {
      setAuthSession(null);
      setAuthStatus("needed");
      setError(
        err instanceof Error
          ? err.message
          : "Sign in is required to load your platform wallet"
      );
      return null;
    }
  }, [address, getSigner, walletClient]);

  const getAuthSession = useCallback(async () => {
    if (!address) return null;
    if (authSession && isAuthSessionFresh(authSession, address)) return authSession;
    const cached = readCachedAuthSession(address);
    if (cached) {
      setAuthSession(cached);
      setAuthStatus("ready");
      return cached;
    }
    return signIn();
  }, [address, authSession, signIn]);

  const refreshAgents = useCallback(async () => {
    if (!address) return;
    setAgentsLoading(true);
    try {
      const res = await fetch(`/api/dashboard/agents?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as DashboardAgentsResponse;
      if (!res.ok) throw new Error(data.error ?? "Failed to load agents");
      setAgents({ owned: data.owned, rented: data.rented });
      const preferred = [...data.owned, ...data.rented][0]?.tokenId ?? null;
      setSelectedAgentId((current) => current ?? preferred);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentsLoading(false);
    }
  }, [address]);

  const refreshWalletLedger = useCallback(async () => {
    if (!address || !walletClient) return;
    try {
      const broker = await getBroker();
      let availableBalanceWei = "0";
      let hasLedger = false;
      try {
        const ledger = await broker.ledger.getLedger();
        availableBalanceWei = String(ledger.availableBalance);
        hasLedger = true;
      } catch {}

      const providerBalances: Record<string, string> = {};
      try {
        const providers = await broker.ledger.getProvidersWithBalance("inference");
        for (const provider of COMPUTE_PROVIDERS) {
          const match = providers.find(
            ([address]) => address.toLowerCase() === provider.address.toLowerCase()
          );
          providerBalances[provider.address] = match?.[1]?.toString() ?? "0";
        }
      } catch {
        for (const provider of COMPUTE_PROVIDERS) providerBalances[provider.address] = "0";
      }
      setWalletLedger({ hasLedger, availableBalanceWei, providerBalances });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWalletLedger({ hasLedger: false, availableBalanceWei: "0", providerBalances: {} });
    }
  }, [address, getBroker, walletClient]);

  const refreshCloudLedger = useCallback(async () => {
    if (!address) {
      setCloudState(null);
      return;
    }
    try {
      const provider = COMPUTE_PROVIDERS[0];
      const res = await fetch(
        `/api/wallet/compute-wallet?address=${encodeURIComponent(address)}&provider=${encodeURIComponent(provider.address)}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => null)) as HostedComputeWalletState | null;
      if (!res.ok || !data) throw new Error(data?.error ?? "Platform wallet unavailable");
      setCloudState(data);
    } catch (err) {
      setCloudState(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [address]);

  const refreshFunds = useCallback(async () => {
    await Promise.all([refreshWalletLedger(), refreshCloudLedger()]);
  }, [refreshCloudLedger, refreshWalletLedger]);

  useEffect(() => {
    if (!accountReady || !address || firstLoadRef.current) return;
    firstLoadRef.current = true;
    queueMicrotask(() => {
      void refreshAgents();
    });
  }, [accountReady, address, refreshAgents]);

  useEffect(() => {
    if (!accountReady || !address) {
      queueMicrotask(() => {
        setAuthSession(null);
        setAuthStatus("checking");
      });
      return;
    }

    const cached = readCachedAuthSession(address);
    queueMicrotask(() => {
      setAuthSession(cached);
      setAuthStatus(cached ? "ready" : "needed");
    });
  }, [accountReady, address]);

  useEffect(() => {
    if (!authSession || !address) return;
    const expiresIn = AUTH_BEARER_CACHE_MS - (Date.now() - authSession.timestamp);
    if (expiresIn <= 0) {
      queueMicrotask(() => {
        setAuthSession(null);
        setAuthStatus("needed");
      });
      return;
    }

    const timeout = window.setTimeout(() => {
      setAuthSession(null);
      setAuthStatus("needed");
    }, expiresIn);
    return () => window.clearTimeout(timeout);
  }, [address, authSession]);

  useEffect(() => {
    if (!accountReady || !address) {
      firstLoadRef.current = false;
      queueMicrotask(() => {
        setAgents({ owned: [], rented: [] });
        setSelectedAgentId(null);
        setWalletLedger(null);
        setCloudState(null);
      });
      return;
    }
    queueMicrotask(() => {
      void refreshFunds();
    });
  }, [accountReady, address, refreshFunds]);

  const withAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setFundLoading(key);
      setError(null);
      try {
        await action();
        await refreshFunds();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setFundLoading(null);
      }
    },
    [refreshFunds]
  );

  const setupCloudWallet = useCallback(async () => {
    await withAction("cloud-setup", async () => {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required to enable the platform wallet");
      const res = await fetch("/api/wallet/compute-wallet/setup", {
        method: "POST",
        headers: { Authorization: session.bearer },
      });
      const data = (await res.json().catch(() => null)) as HostedComputeWalletState | null;
      if (!res.ok || !data) throw new Error(data?.error ?? "Platform wallet setup failed");
      setCloudState(data);
    });
  }, [getAuthSession, withAction]);

  const walletDepositLedger = useCallback(async () => {
    await withAction("wallet-ledger-deposit", async () => {
      const amount = Number(getAmount("wallet-ledger-deposit", walletLedger?.hasLedger ? "1" : "3"));
      const broker = await getBroker();
      if (walletLedger?.hasLedger) await broker.ledger.depositFund(amount);
      else await broker.ledger.addLedger(amount);
    });
  }, [getAmount, getBroker, walletLedger?.hasLedger, withAction]);

  const walletWithdrawLedger = useCallback(async () => {
    await withAction("wallet-ledger-withdraw", async () => {
      const broker = await getBroker();
      await broker.ledger.refund(Number(getAmount("wallet-ledger-withdraw", "1")));
    });
  }, [getAmount, getBroker, withAction]);

  const walletFundProvider = useCallback(async (providerAddress: string) => {
    await withAction(`wallet-provider-fund-${providerAddress}`, async () => {
      const broker = await getBroker();
      await broker.ledger.transferFund(
        providerAddress,
        "inference",
        ogToWei(Number(getAmount(`wallet-provider-fund-${providerAddress}`, "1")))
      );
    });
  }, [getAmount, getBroker, withAction]);

  const walletWithdrawProvider = useCallback(async (providerAddress: string) => {
    await withAction(`wallet-provider-withdraw-${providerAddress}`, async () => {
      const broker = await getBroker();
      await broker.ledger.retrieveFundFromProvider("inference", providerAddress);
    });
  }, [getBroker, withAction]);

  const getCloudDelegate = useCallback(async () => {
    if (!cloudState?.delegate.ready || !cloudState.wallet.address || !cloudState.funding) {
      throw new Error("Enable the platform wallet first");
    }
    const signer = await getSigner();
    return new Contract(cloudState.wallet.address, DELEGATE_ABI, signer);
  }, [cloudState, getSigner]);

  const cloudDepositLedger = useCallback(async () => {
    await withAction("cloud-ledger-deposit", async () => {
      if (!cloudState?.funding) throw new Error("Platform wallet is not ready");
      const delegate = await getCloudDelegate();
      const amount = Number(getAmount("cloud-ledger-deposit", cloudState.ledger.hasLedger ? "1" : "3"));
      const value = parseEther(String(amount));
      const tx = cloudState.ledger.hasLedger
        ? await delegate.depositLedger(cloudState.funding.ledgerAddress, { value })
        : await delegate.createLedger(cloudState.funding.ledgerAddress, "opendock", { value });
      await tx.wait();
    });
  }, [cloudState, getAmount, getCloudDelegate, withAction]);

  const cloudWithdrawLedger = useCallback(async () => {
    await withAction("cloud-ledger-withdraw", async () => {
      if (!cloudState?.funding) throw new Error("Platform wallet is not ready");
      const delegate = await getCloudDelegate();
      const tx = await delegate.refundLedgerToOwner(
        cloudState.funding.ledgerAddress,
        ogToWei(Number(getAmount("cloud-ledger-withdraw", "1")))
      );
      await tx.wait();
    });
  }, [cloudState, getAmount, getCloudDelegate, withAction]);

  const cloudFundProvider = useCallback(async (providerAddress: string) => {
    await withAction(`cloud-provider-fund-${providerAddress}`, async () => {
      if (!cloudState?.funding) throw new Error("Platform wallet is not ready");
      const delegate = await getCloudDelegate();
      const tx = await delegate.fundProvider(
        cloudState.funding.ledgerAddress,
        providerAddress,
        cloudState.funding.serviceName,
        ogToWei(Number(getAmount(`cloud-provider-fund-${providerAddress}`, "1")))
      );
      await tx.wait();
    });
  }, [cloudState, getAmount, getCloudDelegate, withAction]);

  const cloudWithdrawProvider = useCallback(async (providerAddress: string) => {
    await withAction(`cloud-provider-withdraw-${providerAddress}`, async () => {
      if (!cloudState?.funding) throw new Error("Platform wallet is not ready");
      const delegate = await getCloudDelegate();
      const tx = await delegate.retrieveProviderFund(
        cloudState.funding.ledgerAddress,
        providerAddress,
        cloudState.funding.serviceName
      );
      await tx.wait();
    });
  }, [cloudState, getCloudDelegate, withAction]);

  if (walletChecking) {
    return (
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-xl flex flex-col items-center gap-md">
        <span className="inline-block w-8 h-8 border-2 border-outline/30 border-t-outline rounded-full animate-spin" />
        <p className="text-on-surface-variant">Checking wallet connection...</p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-xl flex flex-col items-center gap-md">
        <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>
          account_balance_wallet
        </span>
        <p className="text-on-surface-variant">Connect your wallet to view agents and compute funds.</p>
        <ConnectButton />
      </div>
    );
  }

  const cloudProviderBalances = Object.fromEntries(
    (cloudState?.providerBalances ?? []).map((item) => [item.address, item.balanceWei])
  );

  return (
    <div className="flex flex-col gap-xl">
      <header className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-lg border-b border-outline-variant pb-lg">
        <div className="flex flex-col gap-md">
          <div className="flex items-center gap-sm bg-surface-container-high px-3 py-1.5 rounded-full w-fit border border-outline-variant">
            <div className="w-5 h-5 rounded-full bg-primary shadow-inner" />
            <span className="font-data-mono text-data-mono text-on-surface-variant">
              {shortAddress(address)}
            </span>
          </div>
          <div>
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant uppercase">
              Total Balance
            </span>
            <div className="flex items-baseline gap-2">
              <h1 className="font-h1 text-h1 font-bold text-on-background">
                {formatOg(totalOg, 4).replace(" OG", "")}
              </h1>
              <span className="font-h2 text-h2 font-semibold text-outline">OG</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-md flex flex-col gap-xs">
            <span className="text-xs font-semibold text-on-surface-variant">Wallet</span>
            <span className="font-data-mono text-lg font-semibold text-on-surface">
              {formatOg(walletNativeOg, 4)}
            </span>
            <span className="text-xs text-outline">
              Ledger {formatOg(walletLedgerOg, 4)}
            </span>
          </div>
          <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-md flex flex-col gap-xs">
            <div className="flex items-center justify-between gap-sm">
              <span className="text-xs font-semibold text-on-surface-variant">Cloud Wallet</span>
              {cloudState && (
                <span className="font-data-mono text-[10px] text-outline">
                  {shortAddress(cloudState.wallet.address)}
                </span>
              )}
            </div>
            {cloudState?.delegate.ready ? (
              <>
                <span className="font-data-mono text-lg font-semibold text-on-surface">
                  {formatOg(cloudLedgerOg, 4)}
                </span>
                <button
                  type="button"
                  onClick={cloudDepositLedger}
                  disabled={Boolean(fundLoading)}
                  className="w-fit rounded-full bg-primary text-on-primary px-sm py-xs text-xs font-semibold disabled:opacity-50"
                >
                  Deposit
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={setupCloudWallet}
                disabled={
                  (cloudState !== null && !cloudState.delegate.setupAvailable) ||
                  Boolean(fundLoading) ||
                  authStatus === "signing"
                }
                className="w-fit rounded-full bg-primary text-on-primary px-md py-xs text-xs font-semibold disabled:opacity-50"
              >
                {authStatus === "signing" ? "Signing" : "Enable"}
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error-container/40 px-md py-sm text-sm text-error">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-sm underline">
            Dismiss
          </button>
        </div>
      )}

      <section className="flex flex-col gap-md">
        <div className="flex items-center justify-between gap-md">
          <div>
            <h2 className="font-h2 text-h2 font-semibold text-on-surface">My Agents</h2>
            <p className="text-sm text-on-surface-variant">
              Owned agents are yours. Rented agents are active usage access granted to this wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshAgents}
            disabled={agentsLoading}
            className="rounded-full border border-outline-variant px-md py-xs text-sm font-semibold text-on-surface disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          <div className="flex flex-col gap-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-on-surface">Owned</h3>
              <span className="font-data-mono text-xs text-outline">{agents.owned.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
              {agents.owned.map((agent) => (
                <AgentCard
                  key={agent.tokenId}
                  agent={agent}
                  kind="owned"
                  selected={selectedAgent?.tokenId === agent.tokenId}
                  onSelect={() => setSelectedAgentId(agent.tokenId)}
                />
              ))}
              <Link
                href="/create"
                className="rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-lg min-h-48 flex flex-col items-center justify-center gap-sm hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined">add</span>
                <span className="font-semibold">Deploy New Agent</span>
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-on-surface">Rented</h3>
              <span className="font-data-mono text-xs text-outline">{agents.rented.length}</span>
            </div>
            {agents.rented.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
                {agents.rented.map((agent) => (
                  <AgentCard
                    key={agent.tokenId}
                    agent={agent}
                    kind="rented"
                    selected={selectedAgent?.tokenId === agent.tokenId}
                    onSelect={() => setSelectedAgentId(agent.tokenId)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-lg text-sm text-on-surface-variant">
                No active rented agents for this wallet.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-md">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-md">
          <div>
            <h2 className="font-h2 text-h2 font-semibold text-on-surface">Compute Funds</h2>
            <p className="text-sm text-on-surface-variant">
              Manage your wallet ledger and the selected agent platform wallet.
            </p>
          </div>
          <div className="flex items-center gap-sm">
            <select
              value={selectedAgent?.tokenId ?? ""}
              onChange={(event) => setSelectedAgentId(event.target.value || null)}
              className="rounded-lg border border-outline-variant bg-surface-container px-sm py-xs text-sm text-on-surface focus:outline-none focus:border-primary"
            >
              {allAgents.map((agent) => (
                <option key={agent.tokenId} value={agent.tokenId}>
                  {agent.name ?? `Agent #${agent.tokenId}`} #{agent.tokenId}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={refreshFunds}
              disabled={Boolean(fundLoading)}
              className="rounded-full border border-outline-variant px-md py-xs text-sm font-semibold text-on-surface disabled:opacity-50"
            >
              Refresh Funds
            </button>
          </div>
        </div>

        <div className="flex items-center gap-sm border-b border-outline-variant">
          {(["providers", "ledger"] as FundsTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFundsTab(tab)}
              className={`px-sm pb-sm text-sm font-semibold border-b-2 ${
                fundsTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant"
              }`}
            >
              {tab === "providers" ? "Providers" : "Ledger"}
            </button>
          ))}
        </div>

        {fundsTab === "ledger" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
            <LedgerTable
              title="Wallet"
              balance={walletLedgerOg}
              hasLedger={walletLedger?.hasLedger ?? false}
              depositKey="wallet-ledger-deposit"
              withdrawKey="wallet-ledger-withdraw"
              getAmount={getAmount}
              setAmount={setAmount}
              onDeposit={walletDepositLedger}
              onWithdraw={walletWithdrawLedger}
              loading={fundLoading}
            />
            <LedgerTable
              title="Cloud Wallet"
              balance={cloudLedgerOg}
              hasLedger={cloudState?.ledger.hasLedger ?? false}
              disabled={!cloudState?.delegate.ready}
              depositKey="cloud-ledger-deposit"
              withdrawKey="cloud-ledger-withdraw"
              getAmount={getAmount}
              setAmount={setAmount}
              onDeposit={cloudDepositLedger}
              onWithdraw={cloudWithdrawLedger}
              loading={fundLoading}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
            <ProviderTable
              title="Wallet"
              balances={walletLedger?.providerBalances ?? {}}
              getAmount={getAmount}
              setAmount={setAmount}
              onFund={walletFundProvider}
              onWithdraw={walletWithdrawProvider}
              loading={fundLoading}
              disabled={!walletLedger?.hasLedger}
            />
            <ProviderTable
              title="Cloud Wallet"
              balances={cloudProviderBalances}
              getAmount={getAmount}
              setAmount={setAmount}
              onFund={cloudFundProvider}
              onWithdraw={cloudWithdrawProvider}
              loading={fundLoading}
              disabled={
                !cloudState?.delegate.ready ||
                !cloudState.ledger.hasLedger
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function LedgerTable({
  title,
  balance,
  hasLedger,
  disabled,
  depositKey,
  withdrawKey,
  getAmount,
  setAmount,
  onDeposit,
  onWithdraw,
  loading,
}: {
  title: string;
  balance: number;
  hasLedger: boolean;
  disabled?: boolean;
  depositKey: string;
  withdrawKey: string;
  getAmount: (key: string, fallback?: string) => string;
  setAmount: (key: string, value: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  loading: string | null;
}) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
      <div className="px-md py-sm border-b border-outline-variant/30 flex items-center justify-between">
        <h3 className="font-semibold text-on-surface">{title}</h3>
        <span className="font-data-mono text-sm text-on-surface">{formatOg(balance, 4)}</span>
      </div>
      <div className="p-md flex flex-col gap-sm">
        <div className="grid grid-cols-[1fr_auto_auto] gap-sm items-center">
          <div>
            <p className="text-sm font-semibold text-on-surface">Ledger</p>
            <p className="text-xs text-outline">{hasLedger ? "Available balance" : "No ledger yet"}</p>
          </div>
          <AmountInput
            value={getAmount(depositKey, hasLedger ? "1" : "3")}
            onChange={(value) => setAmount(depositKey, value)}
          />
          <button
            type="button"
            onClick={onDeposit}
            disabled={disabled || Boolean(loading)}
            className="rounded-full bg-primary text-on-primary px-sm py-xs text-xs font-semibold disabled:opacity-50"
          >
            {hasLedger ? "Deposit" : "Create"}
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-sm items-center">
          <div>
            <p className="text-sm font-semibold text-on-surface">Withdraw</p>
            <p className="text-xs text-outline">Refund ledger balance</p>
          </div>
          <AmountInput
            value={getAmount(withdrawKey, "1")}
            onChange={(value) => setAmount(withdrawKey, value)}
          />
          <button
            type="button"
            onClick={onWithdraw}
            disabled={disabled || !hasLedger || balance <= 0 || Boolean(loading)}
            className="rounded-full border border-outline-variant px-sm py-xs text-xs font-semibold text-on-surface disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderTable({
  title,
  balances,
  getAmount,
  setAmount,
  onFund,
  onWithdraw,
  loading,
  disabled,
}: {
  title: string;
  balances: Record<string, string>;
  getAmount: (key: string, fallback?: string) => string;
  setAmount: (key: string, value: string) => void;
  onFund: (providerAddress: string) => void;
  onWithdraw: (providerAddress: string) => void;
  loading: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
      <div className="px-md py-sm border-b border-outline-variant/30 flex items-center justify-between">
        <h3 className="font-semibold text-on-surface">{title}</h3>
        {disabled && <span className="text-xs text-outline">Ledger required</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-container-low text-xs text-on-surface-variant">
            <tr>
              <th className="text-left font-semibold px-md py-sm">Provider</th>
              <th className="text-right font-semibold px-md py-sm">Balance</th>
              <th className="text-left font-semibold px-md py-sm">Amount</th>
              <th className="text-right font-semibold px-md py-sm">Actions</th>
            </tr>
          </thead>
          <tbody>
            {COMPUTE_PROVIDERS.map((provider) => {
              const fundKey = `${title.toLowerCase().replace(/\s/g, "-")}-provider-fund-${provider.address}`;
              const withdrawKey = `${title.toLowerCase().replace(/\s/g, "-")}-provider-withdraw-${provider.address}`;
              const balance = weiToOg(balances[provider.address]);
              return (
                <tr key={provider.address} className="border-t border-outline-variant/20">
                  <td className="px-md py-sm">
                    <div className="flex flex-col">
                      <span className="font-semibold text-on-surface">{provider.label}</span>
                      <span className="font-data-mono text-[10px] text-outline">
                        {shortAddress(provider.address)}
                      </span>
                    </div>
                  </td>
                  <td className="px-md py-sm text-right font-data-mono text-on-surface">
                    {formatOg(balance, 4)}
                  </td>
                  <td className="px-md py-sm">
                    <AmountInput
                      value={getAmount(fundKey, "1")}
                      onChange={(value) => {
                        setAmount(fundKey, value);
                        setAmount(withdrawKey, value);
                      }}
                    />
                  </td>
                  <td className="px-md py-sm">
                    <div className="flex justify-end gap-xs">
                      <button
                        type="button"
                        onClick={() => onFund(provider.address)}
                        disabled={disabled || Boolean(loading)}
                        className="rounded-full bg-primary text-on-primary px-sm py-xs text-xs font-semibold disabled:opacity-50"
                      >
                        Fund
                      </button>
                      <button
                        type="button"
                        onClick={() => onWithdraw(provider.address)}
                        disabled={disabled || balance <= 0 || Boolean(loading)}
                        className="rounded-full border border-outline-variant px-sm py-xs text-xs font-semibold text-on-surface disabled:opacity-50"
                      >
                        Withdraw
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
