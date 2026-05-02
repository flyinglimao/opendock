"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useConfig, useWalletClient } from "wagmi";
import type { Config } from "wagmi";
import { BrowserProvider, Contract, parseEther } from "ethers";
import { buildSessionAuthMessage } from "@/lib/auth";
import { COMPUTE_PROVIDERS } from "@/lib/compute-providers";
import { isCronExpression } from "@/lib/cron";

type DashboardTab = "agents" | "automations" | "funds" | "settings";
type FundsTab = "ledger" | "providers";
type AuthSessionStatus = "checking" | "ready" | "needed" | "signing";

interface UserSettings {
  hasBraveApiKey: boolean;
  braveApiKey: string | null;
  hasTelegramBinding: boolean;
  telegramUserId: string | null;
}

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

interface AutomationsResponse {
  automations?: DashboardAutomation[];
  automation?: DashboardAutomation;
  error?: string;
}

interface WalletLedgerState {
  hasLedger: boolean;
  availableBalanceWei: string;
  providerBalances: Record<string, string>;
}

interface DashboardAutomation {
  id: string;
  tokenId: string;
  agentName: string;
  agentImage: string | null;
  cronExpression: string;
  instruction: string;
  enabled: boolean;
  updatedAt: string;
  history: DashboardAutomationHistory[];
}

interface DashboardAutomationHistory {
  id: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
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

function agentDisplayName(agent: DashboardAgent): string {
  return agent.name ?? `Agent #${agent.tokenId}`;
}

function formatDashboardTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
}: {
  agent: DashboardAgent;
  kind: "owned" | "rented";
}) {
  const displayName = agent.name ?? `Agent #${agent.tokenId}`;
  return (
    <article className="bg-surface-container-lowest rounded-lg border border-outline-variant/40 text-left overflow-hidden shadow-[0px_4px_20px_rgba(0,0,0,0.04)]">
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
        >
          Open agent
        </Link>
      </div>
    </article>
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
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("agents");
  const [automations, setAutomations] = useState<DashboardAutomation[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const [fundsTab, setFundsTab] = useState<FundsTab>("providers");
  const [walletLedger, setWalletLedger] = useState<WalletLedgerState | null>(null);
  const [cloudState, setCloudState] = useState<HostedComputeWalletState | null>(null);
  const [authSession, setAuthSession] = useState<CachedAuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthSessionStatus>("checking");
  const [fundLoading, setFundLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const firstLoadRef = useRef(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [braveKeyInput, setBraveKeyInput] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [telegramToken, setTelegramToken] = useState<string | null>(null);
  const [telegramTokenExpiresAt, setTelegramTokenExpiresAt] = useState<number | null>(null);
  const [telegramTokenLoading, setTelegramTokenLoading] = useState(false);
  const [telegramVerifyLoading, setTelegramVerifyLoading] = useState(false);
  const [telegramVerifyResult, setTelegramVerifyResult] = useState<"success" | "pending" | null>(null);
  const [telegramCopied, setTelegramCopied] = useState(false);
  const [telegramUnbindLoading, setTelegramUnbindLoading] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const accountReady = hydrated && Boolean(address);
  const walletChecking =
    !hydrated ||
    !wagmiStoreHydrated ||
    status === "connecting" ||
    status === "reconnecting";

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentsLoading(false);
    }
  }, [address]);

  const refreshAutomations = useCallback(async () => {
    if (!address) return;
    setAutomationsLoading(true);
    setAutomationError(null);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch("/api/automations", {
        headers: { Authorization: session.bearer },
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as AutomationsResponse | null;
      if (!res.ok || !data) {
        throw new Error(data?.error ?? "Failed to load automations");
      }
      setAutomations(data.automations ?? []);
    } catch (err) {
      setAutomationError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutomationsLoading(false);
    }
  }, [address, getAuthSession]);

  const saveAutomation = useCallback(async ({
    automationId,
    tokenId,
    cronExpression,
    instruction,
    enabled,
  }: {
    automationId?: string;
    tokenId?: string;
    cronExpression: string;
    instruction: string;
    enabled: boolean;
  }) => {
    if (!address) throw new Error("Wallet not connected");
    setAutomationSaving(true);
    setAutomationError(null);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch(
        automationId ? `/api/automations/${automationId}` : "/api/automations",
        {
          method: automationId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: session.bearer,
          },
          body: JSON.stringify({
            tokenId,
            cronExpression,
            instruction,
            enabled,
          }),
        }
      );
      const data = (await res.json().catch(() => null)) as AutomationsResponse | null;
      if (!res.ok || !data?.automation) {
        throw new Error(data?.error ?? "Failed to save automation");
      }
      return data.automation;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAutomationError(message);
      throw err;
    } finally {
      setAutomationSaving(false);
    }
  }, [address, getAuthSession]);

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

  const refreshSettings = useCallback(async () => {
    if (!address) return;
    const session = await getAuthSession();
    if (!session) return;
    try {
      const res = await fetch("/api/settings", {
        headers: { Authorization: session.bearer },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as UserSettings;
      setUserSettings(data);
      setBraveKeyInput("");
    } catch {
      // ignore
    }
  }, [address, getAuthSession]);

  const saveSettings = useCallback(async () => {
    if (!address) return;
    setSettingsLoading(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: session.bearer,
        },
        body: JSON.stringify({ braveApiKey: braveKeyInput || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to save settings");
      }
      await refreshSettings();
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsLoading(false);
    }
  }, [address, braveKeyInput, getAuthSession, refreshSettings]);

  const clearBraveKey = useCallback(async () => {
    if (!address) return;
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: session.bearer,
        },
        body: JSON.stringify({ braveApiKey: null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to clear key");
      }
      await refreshSettings();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsLoading(false);
    }
  }, [address, getAuthSession, refreshSettings]);

  const generateTelegramToken = useCallback(async () => {
    if (!address) return;
    setTelegramTokenLoading(true);
    setTelegramVerifyResult(null);
    setTelegramToken(null);
    setTelegramError(null);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch("/api/settings/telegram/token", {
        method: "POST",
        headers: { Authorization: session.bearer },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to generate token");
      }
      const data = (await res.json()) as { token: string; expiresAt: number };
      setTelegramToken(data.token);
      setTelegramTokenExpiresAt(data.expiresAt);
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : String(err));
    } finally {
      setTelegramTokenLoading(false);
    }
  }, [address, getAuthSession]);

  const verifyTelegramToken = useCallback(async () => {
    if (!address || !telegramToken) return;
    setTelegramVerifyLoading(true);
    setTelegramError(null);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch("/api/settings/telegram/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session.bearer,
        },
        body: JSON.stringify({ token: telegramToken }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Verification failed");
      }
      const data = (await res.json()) as { bound: boolean };
      if (data.bound) {
        setTelegramVerifyResult("success");
        setTelegramToken(null);
        setTelegramTokenExpiresAt(null);
        await refreshSettings();
      } else {
        setTelegramVerifyResult("pending");
      }
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : String(err));
    } finally {
      setTelegramVerifyLoading(false);
    }
  }, [address, getAuthSession, refreshSettings, telegramToken]);

  const unbindTelegram = useCallback(async () => {
    if (!address) return;
    setTelegramUnbindLoading(true);
    setTelegramError(null);
    try {
      const session = await getAuthSession();
      if (!session) throw new Error("Sign in is required");
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: session.bearer,
        },
        body: JSON.stringify({ telegramUserId: null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to unbind");
      }
      await refreshSettings();
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : String(err));
    } finally {
      setTelegramUnbindLoading(false);
    }
  }, [address, getAuthSession, refreshSettings]);

  const copyTelegramCommand = useCallback(() => {
    if (!telegramToken) return;
    void navigator.clipboard.writeText(`/register ${telegramToken}`);
    setTelegramCopied(true);
    setTimeout(() => setTelegramCopied(false), 2000);
  }, [telegramToken]);

  useEffect(() => {
    if (!accountReady || !address || firstLoadRef.current) return;
    firstLoadRef.current = true;
    queueMicrotask(() => {
      void refreshAgents();
    });
  }, [accountReady, address, refreshAgents]);

  // Load settings once authenticated
  useEffect(() => {
    if (!accountReady || !address || authStatus !== "ready") return;
    queueMicrotask(() => {
      void refreshSettings();
      void refreshAutomations();
    });
  }, [accountReady, address, authStatus, refreshAutomations, refreshSettings]);

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
        setAutomations([]);
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
  const automationAgents = [...agents.owned, ...agents.rented];
  const dashboardTabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
    { id: "agents", label: "My Agents", icon: "smart_toy" },
    { id: "automations", label: "Automation", icon: "routine" },
    { id: "funds", label: "Platform Funds", icon: "account_balance_wallet" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

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
              <span className="text-xs font-semibold text-on-surface-variant">Platform Wallet</span>
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

      <nav className="flex items-center gap-sm overflow-x-auto border-b border-outline-variant">
        {dashboardTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setDashboardTab(tab.id)}
            className={`flex items-center gap-xs px-sm pb-sm text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
              dashboardTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {tab.icon}
            </span>
            {tab.label}
          </button>
        ))}
      </nav>

      {dashboardTab === "agents" && (
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
      )}

      {dashboardTab === "automations" && (
        <AutomationTab
          agents={automationAgents}
          agentsLoading={agentsLoading}
          automationsLoading={automationsLoading}
          automationSaving={automationSaving}
          automationError={automationError}
          automations={automations}
          setAutomations={setAutomations}
          onSaveAutomation={saveAutomation}
          onRefreshAgents={refreshAgents}
          onRefreshAutomations={refreshAutomations}
        />
      )}

      {dashboardTab === "funds" && (
      <section className="flex flex-col gap-md">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-md">
          <div>
            <h2 className="font-h2 text-h2 font-semibold text-on-surface">Compute Funds</h2>
            <p className="text-sm text-on-surface-variant">
              Manage your wallet ledger and platform wallet.
            </p>
          </div>
          <div className="flex items-center gap-sm">
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
              title="Platform Wallet"
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
              title="Platform Wallet"
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
      )}

      {/* Settings Section */}
      {dashboardTab === "settings" && (
      <section className="flex flex-col gap-md">
        <div>
          <h2 className="font-h2 text-h2 font-semibold text-on-surface">Settings</h2>
          <p className="text-sm text-on-surface-variant">
            Configure optional integrations for your agents.
          </p>
        </div>

        {/* Web Search */}
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
          <div className="px-md py-sm border-b border-outline-variant/30 flex items-center justify-between">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-on-surface" style={{ fontSize: 18 }}>travel_explore</span>
              <h3 className="font-semibold text-on-surface">Web Search (Brave API)</h3>
            </div>
            {userSettings?.hasBraveApiKey ? (
              <span className="inline-flex items-center gap-xs rounded-full bg-green-50 border border-green-200 px-sm py-0.5 text-[11px] font-semibold text-green-700">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Configured
              </span>
            ) : (
              <span className="inline-flex items-center gap-xs rounded-full bg-surface-container-high border border-outline-variant px-sm py-0.5 text-[11px] font-semibold text-outline">
                <span className="w-1.5 h-1.5 rounded-full bg-outline/40 inline-block" />
                Not configured
              </span>
            )}
          </div>

          <div className="p-md flex flex-col gap-md">
            <p className="text-sm text-on-surface-variant">
              Agents can search the web in real-time when you provide a Brave Search API key.
              Get a free key at{" "}
              <a
                href="https://brave.com/search/api/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                brave.com/search/api
              </a>
              {" "}(free tier: 2,000 queries/month).
            </p>

            {userSettings?.hasBraveApiKey && (
              <div className="flex items-center gap-sm rounded-md border border-outline-variant/40 bg-surface-container-low px-md py-sm">
                <span className="material-symbols-outlined text-outline" style={{ fontSize: 16 }}>key</span>
                <span className="font-data-mono text-sm text-on-surface-variant flex-1 truncate">
                  {userSettings.braveApiKey ?? "•••••••••••••"}
                </span>
                <button
                  type="button"
                  onClick={clearBraveKey}
                  disabled={settingsLoading}
                  className="text-xs font-semibold text-error hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-sm">
              <input
                type="password"
                placeholder={userSettings?.hasBraveApiKey ? "Enter new key to replace" : "BSA..."}
                value={braveKeyInput}
                onChange={(e) => setBraveKeyInput(e.target.value)}
                autoComplete="off"
                className="flex-1 rounded-md border border-outline-variant bg-white px-md py-sm text-sm text-on-surface focus:outline-none focus:border-primary placeholder:text-outline/60"
              />
              <button
                type="button"
                onClick={saveSettings}
                disabled={settingsLoading || !braveKeyInput.trim()}
                className="rounded-full bg-primary text-on-primary px-lg py-sm text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
              >
                {settingsLoading ? "Saving…" : "Save Key"}
              </button>
            </div>

            {settingsSaved && (
              <p className="text-xs font-semibold text-green-700">
                ✓ Settings saved successfully.
              </p>
            )}
            {settingsError && (
              <p className="text-xs text-error">{settingsError}</p>
            )}

            {authStatus === "needed" && (
              <p className="text-xs text-on-surface-variant">
                You need to{" "}
                <button
                  type="button"
                  onClick={signIn}
                  className="text-primary font-semibold underline"
                >
                  sign in
                </button>
                {" "}to manage settings.
              </p>
            )}
          </div>
        </div>

        {/* Telegram */}
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
          <div className="px-md py-sm border-b border-outline-variant/30 flex items-center justify-between">
            <div className="flex items-center gap-sm">
              {/* Telegram send icon via material-symbols */}
              <span className="material-symbols-outlined text-on-surface" style={{ fontSize: 18 }}>send</span>
              <h3 className="font-semibold text-on-surface">Telegram</h3>
            </div>
            {userSettings?.hasTelegramBinding ? (
              <span className="inline-flex items-center gap-xs rounded-full bg-green-50 border border-green-200 px-sm py-0.5 text-[11px] font-semibold text-green-700">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Bound
              </span>
            ) : (
              <span className="inline-flex items-center gap-xs rounded-full bg-surface-container-high border border-outline-variant px-sm py-0.5 text-[11px] font-semibold text-outline">
                <span className="w-1.5 h-1.5 rounded-full bg-outline/40 inline-block" />
                Not bound
              </span>
            )}
          </div>

          <div className="p-md flex flex-col gap-md">
            {userSettings?.hasTelegramBinding ? (
              /* Already bound */
              <>
                <div className="flex items-center gap-sm rounded-md border border-outline-variant/40 bg-surface-container-low px-md py-sm">
                  <span className="material-symbols-outlined text-outline" style={{ fontSize: 16 }}>link</span>
                  <span className="font-data-mono text-sm text-on-surface-variant flex-1">
                    User ID: {userSettings.telegramUserId}
                  </span>
                  <button
                    type="button"
                    onClick={unbindTelegram}
                    disabled={telegramUnbindLoading}
                    className="text-xs font-semibold text-error hover:underline disabled:opacity-50"
                  >
                    {telegramUnbindLoading ? "Unbinding…" : "Unbind"}
                  </button>
                </div>
                <p className="text-sm text-on-surface-variant">
                  Your Telegram account is linked. Agents can send you notifications via{" "}
                  <a
                    href="https://t.me/opendock_bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                  >
                    @opendock_bot
                  </a>.
                </p>
                {telegramError && (
                  <p className="text-xs text-error">{telegramError}</p>
                )}
              </>
            ) : (
              /* Not yet bound */
              <>
                <p className="text-sm text-on-surface-variant">
                  Link your Telegram account so agents can send you notifications.{" "}
                  Open{" "}
                  <a
                    href="https://t.me/opendock_bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:text-primary/80"
                  >
                    @opendock_bot
                  </a>{" "}
                  on Telegram, then generate a token below and send the command to the bot.
                </p>

                {!telegramToken ? (
                  <>
                    <button
                      type="button"
                      onClick={generateTelegramToken}
                      disabled={telegramTokenLoading || authStatus === "needed"}
                      className="w-fit rounded-full bg-primary text-on-primary px-lg py-sm text-sm font-semibold disabled:opacity-50"
                    >
                      {telegramTokenLoading ? "Generating…" : "Generate Token"}
                    </button>
                    {telegramError && (
                      <p className="text-xs text-error">{telegramError}</p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-sm">
                    <p className="text-xs text-on-surface-variant">
                      Send the command below to{" "}
                      <a
                        href="https://t.me/opendock_bot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        @opendock_bot
                      </a>.
                      {" "}Token expires{" "}
                      {telegramTokenExpiresAt
                        ? new Date(telegramTokenExpiresAt).toLocaleTimeString()
                        : "soon"}.
                    </p>
                    <div className="flex items-center gap-sm rounded-md border border-outline-variant/40 bg-surface-container-low px-md py-sm font-data-mono text-sm text-on-surface">
                      <span className="flex-1 truncate select-all">/register {telegramToken}</span>
                      <button
                        type="button"
                        onClick={copyTelegramCommand}
                        className="text-xs font-semibold text-primary hover:underline whitespace-nowrap"
                      >
                        {telegramCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div className="flex items-center gap-sm">
                      <button
                        type="button"
                        onClick={verifyTelegramToken}
                        disabled={telegramVerifyLoading}
                        className="rounded-full bg-primary text-on-primary px-lg py-sm text-sm font-semibold disabled:opacity-50"
                      >
                        {telegramVerifyLoading ? "Checking…" : "Check"}
                      </button>
                      <button
                        type="button"
                        onClick={generateTelegramToken}
                        disabled={telegramTokenLoading}
                        className="rounded-full border border-outline-variant px-md py-sm text-sm font-semibold text-on-surface disabled:opacity-50"
                      >
                        Regenerate
                      </button>
                    </div>
                    {telegramVerifyResult === "pending" && (
                      <p className="text-xs text-on-surface-variant">
                        ⏳ Not received yet — send the command to the bot first, then click Check again.
                      </p>
                    )}
                    {telegramVerifyResult === "success" && (
                      <p className="text-xs font-semibold text-green-700">
                        ✓ Telegram account bound successfully!
                      </p>
                    )}
                    {telegramError && (
                      <p className="text-xs text-error">{telegramError}</p>
                    )}
                  </div>
                )}

                {authStatus === "needed" && (
                  <p className="text-xs text-on-surface-variant">
                    You need to{" "}
                    <button
                      type="button"
                      onClick={signIn}
                      className="text-primary font-semibold underline"
                    >
                      sign in
                    </button>
                    {" "}to bind Telegram.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

function AutomationTab({
  agents,
  agentsLoading,
  automationsLoading,
  automationSaving,
  automationError,
  automations,
  setAutomations,
  onSaveAutomation,
  onRefreshAgents,
  onRefreshAutomations,
}: {
  agents: DashboardAgent[];
  agentsLoading: boolean;
  automationsLoading: boolean;
  automationSaving: boolean;
  automationError: string | null;
  automations: DashboardAutomation[];
  setAutomations: Dispatch<SetStateAction<DashboardAutomation[]>>;
  onSaveAutomation: (input: {
    automationId?: string;
    tokenId?: string;
    cronExpression: string;
    instruction: string;
    enabled: boolean;
  }) => Promise<DashboardAutomation>;
  onRefreshAgents: () => void;
  onRefreshAutomations: () => void;
}) {
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [draftAgent, setDraftAgent] = useState<DashboardAgent | null>(null);
  const [cronInput, setCronInput] = useState("");
  const [instructionInput, setInstructionInput] = useState("");
  const [enabledInput, setEnabledInput] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);

  const selectedAutomation =
    automations.find((automation) => automation.id === selectedAutomationId) ?? null;
  const activeAgent =
    selectedAutomation
      ? agents.find((agent) => agent.tokenId === selectedAutomation.tokenId) ?? null
      : draftAgent;
  const activeAgentName = selectedAutomation?.agentName ?? (activeAgent ? agentDisplayName(activeAgent) : "");
  const activeAgentImage = selectedAutomation?.agentImage ?? activeAgent?.image ?? null;
  const hasSelection = Boolean(selectedAutomation || draftAgent);
  const cronIsValid = isCronExpression(cronInput);
  const isDirty = selectedAutomation
    ? cronInput !== selectedAutomation.cronExpression ||
      instructionInput !== selectedAutomation.instruction ||
      enabledInput !== selectedAutomation.enabled
    : Boolean(draftAgent && (cronInput.trim() || instructionInput.trim() || !enabledInput));
  const canSave = isDirty && cronIsValid && Boolean(instructionInput.trim());

  useEffect(() => {
    queueMicrotask(() => {
      setSavedNotice(false);
      if (selectedAutomation) {
        setCronInput(selectedAutomation.cronExpression);
        setInstructionInput(selectedAutomation.instruction);
        setEnabledInput(selectedAutomation.enabled);
        return;
      }
      if (draftAgent) {
        setCronInput("");
        setInstructionInput("");
        setEnabledInput(true);
        return;
      }
      setCronInput("");
      setInstructionInput("");
      setEnabledInput(true);
    });
  }, [draftAgent, selectedAutomation]);

  const selectAutomation = (automation: DashboardAutomation) => {
    setSelectedAutomationId(automation.id);
    setDraftAgent(null);
  };

  const selectAgentForAutomation = (agent: DashboardAgent) => {
    setSelectedAutomationId(null);
    setDraftAgent(agent);
  };

  const saveAutomation = async () => {
    if (!hasSelection || !canSave) return;
    if (selectedAutomation) {
      const saved = await onSaveAutomation({
        automationId: selectedAutomation.id,
        cronExpression: cronInput.trim(),
        instruction: instructionInput.trim(),
        enabled: enabledInput,
      });
      setAutomations((current) =>
        current.map((automation) =>
          automation.id === selectedAutomation.id ? saved : automation
        )
      );
      setSavedNotice(true);
      return;
    }
    if (!draftAgent) return;
    const saved = await onSaveAutomation({
      tokenId: draftAgent.tokenId,
      cronExpression: cronInput.trim(),
      instruction: instructionInput.trim(),
      enabled: enabledInput,
    });
    setAutomations((current) => [saved, ...current]);
    setSelectedAutomationId(saved.id);
    setDraftAgent(null);
    setSavedNotice(true);
  };

  const resetForm = () => {
    if (selectedAutomation) {
      setCronInput(selectedAutomation.cronExpression);
      setInstructionInput(selectedAutomation.instruction);
      setEnabledInput(selectedAutomation.enabled);
      return;
    }
    setCronInput("");
    setInstructionInput("");
    setEnabledInput(true);
  };

  return (
    <section className="flex flex-col gap-md">
      <div className="flex items-end justify-between gap-md flex-wrap">
        <div>
          <h2 className="font-h2 text-h2 font-semibold text-on-surface">Automation</h2>
          <p className="text-sm text-on-surface-variant">
            Review agent automations and prepare new cron instructions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onRefreshAgents();
            onRefreshAutomations();
          }}
          disabled={agentsLoading || automationsLoading}
          title="Refresh automation data"
          aria-label="Refresh automation data"
          className="w-10 h-10 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50 flex items-center justify-center transition-colors"
        >
          <span className={`material-symbols-outlined ${agentsLoading || automationsLoading ? "animate-spin" : ""}`} style={{ fontSize: 20 }}>
            refresh
          </span>
        </button>
      </div>

      {automationError && (
        <div className="rounded-lg border border-error/30 bg-error-container/40 px-md py-sm text-sm text-error">
          {automationError}
        </div>
      )}

      <div className="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-lg items-start">
        <aside className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden">
          <div className="px-lg py-md border-b border-outline-variant/30 flex items-center justify-between">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">
              Automations
            </span>
            <span className="font-data-mono text-data-mono text-outline">
              {automations.length}
            </span>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {automationsLoading && automations.length === 0 ? (
              <div className="p-md flex flex-col gap-sm">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-20 rounded-lg bg-surface-container animate-pulse" />
                ))}
              </div>
            ) : automations.length === 0 ? (
              <div className="p-lg text-sm text-outline">
                No automations yet.
              </div>
            ) : (
              <div className="p-sm flex flex-col gap-xs">
                {automations.map((automation) => {
                  const selected = automation.id === selectedAutomationId;
                  return (
                    <button
                      key={automation.id}
                      type="button"
                      onClick={() => selectAutomation(automation)}
                      className={`text-left rounded-lg border p-sm flex gap-sm transition-colors ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:border-outline-variant hover:bg-surface-container"
                      }`}
                    >
                      <AutomationAvatar name={automation.agentName} image={automation.agentImage} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-sm">
                          <span className="text-sm font-semibold text-on-surface truncate">
                            {automation.agentName}
                          </span>
                          <span
                            className={`text-[11px] shrink-0 ${
                              automation.enabled ? "text-green-700" : "text-outline"
                            }`}
                          >
                            {automation.enabled ? "Active" : "Paused"}
                          </span>
                        </div>
                        <div className="text-xs text-on-surface-variant truncate mt-0.5">
                          {automation.cronExpression}
                        </div>
                        <div className="text-xs text-outline truncate mt-xs">
                          {automation.instruction}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="border-t border-outline-variant/30">
              <div className="px-lg py-md flex items-center justify-between">
                <span className="font-label-caps text-label-caps font-semibold text-on-surface">
                  New From Agent
                </span>
                <span className="font-data-mono text-data-mono text-outline">
                  {agents.length}
                </span>
              </div>
              <div className="p-sm pt-0 flex flex-col gap-xs">
                {agentsLoading && agents.length === 0 ? (
                  [0, 1, 2].map((item) => (
                    <div key={item} className="h-16 rounded-lg bg-surface-container animate-pulse" />
                  ))
                ) : agents.length === 0 ? (
                  <div className="p-md text-sm text-outline">
                    No available agents.
                  </div>
                ) : (
                  agents.map((agent) => {
                    const selected = draftAgent?.tokenId === agent.tokenId;
                    return (
                      <button
                        key={`${agent.tokenId}-${agent.activeRental ? "rented" : "owned"}`}
                        type="button"
                        onClick={() => selectAgentForAutomation(agent)}
                        className={`text-left rounded-lg border p-sm flex gap-sm transition-colors ${
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:border-outline-variant hover:bg-surface-container"
                        }`}
                      >
                        <AutomationAvatar name={agentDisplayName(agent)} image={agent.image} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-sm">
                            <span className="text-sm font-semibold text-on-surface truncate">
                              {agentDisplayName(agent)}
                            </span>
                            <span className="text-[11px] text-outline shrink-0">
                              {agent.activeRental ? "Rented" : "Owned"}
                            </span>
                          </div>
                          <div className="text-xs text-on-surface-variant truncate mt-xs">
                            {agent.description ?? "Ready for automation"}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          {!hasSelection ? (
            <div className="h-full min-h-[520px] bg-surface-container-lowest border border-outline-variant/40 rounded-xl p-xl flex flex-col items-center justify-center gap-sm text-center text-outline">
              <span className="material-symbols-outlined" style={{ fontSize: 44 }}>
                routine
              </span>
              <p className="font-body-sub text-body-sub">
                Select an automation or choose an agent to create one.
              </p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden flex flex-col min-h-[520px]">
              <div className="px-lg py-md border-b border-outline-variant/30 flex items-center justify-between gap-md flex-wrap">
                <div className="flex items-center gap-md min-w-0">
                  <AutomationAvatar name={activeAgentName} image={activeAgentImage} />
                  <div className="min-w-0">
                    <h3 className="font-h2 text-h2 font-semibold text-on-surface truncate">
                      {selectedAutomation ? "Automation Settings" : "New Automation"}
                    </h3>
                    <p className="text-xs text-outline truncate">
                      {activeAgentName}
                      {selectedAutomation ? ` · updated ${formatDashboardTime(selectedAutomation.updatedAt)}` : ""}
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-sm cursor-pointer select-none shrink-0 border border-outline-variant rounded-lg px-sm py-xs bg-surface-container">
                  <span className={`text-xs font-semibold ${enabledInput ? "text-on-surface" : "text-outline"}`}>
                    Enabled
                  </span>
                  <input
                    type="checkbox"
                    checked={enabledInput}
                    onChange={(event) => {
                      setEnabledInput(event.target.checked);
                      setSavedNotice(false);
                    }}
                    className="sr-only"
                  />
                  <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${enabledInput ? "bg-primary" : "bg-outline-variant"}`}>
                    <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabledInput ? "translate-x-4" : "translate-x-0"}`} />
                  </span>
                </label>
              </div>

              <div className="p-lg flex flex-col gap-lg">
                <label className="flex flex-col gap-xs">
                  <span className="text-sm font-semibold text-on-surface">Cron</span>
                  <input
                    type="text"
                    value={cronInput}
                    onChange={(event) => {
                      setCronInput(event.target.value);
                      setSavedNotice(false);
                    }}
                    placeholder="0 9 * * 1-5"
                    className="rounded-lg border border-outline-variant bg-white px-md py-sm font-data-mono text-sm text-on-surface focus:outline-none focus:border-primary placeholder:text-outline/60"
                  />
                  {cronInput.trim() && !cronIsValid && (
                    <span className="text-xs text-error">
                      Use five cron fields, for example 0 9 * * 1-5.
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-xs">
                  <span className="text-sm font-semibold text-on-surface">Instruction</span>
                  <textarea
                    value={instructionInput}
                    onChange={(event) => {
                      setInstructionInput(event.target.value);
                      setSavedNotice(false);
                    }}
                    placeholder="Summarize new market signals and send me the important changes."
                    rows={10}
                    className="rounded-lg border border-outline-variant bg-white px-md py-sm text-sm text-on-surface focus:outline-none focus:border-primary placeholder:text-outline/60 resize-y min-h-48"
                  />
                </label>

                <div className="flex items-center justify-between gap-md flex-wrap border-t border-outline-variant/30 pt-md">
                  <div className="text-xs text-outline">
                    {selectedAutomation ? "Changes are saved to the selected automation." : "This will create a new automation for the selected agent."}
                  </div>
                  <div className="flex items-center gap-sm">
                    <button
                      type="button"
                      onClick={resetForm}
                      disabled={!isDirty || automationSaving}
                      className="rounded-full border border-outline-variant px-md py-sm text-sm font-semibold text-on-surface disabled:opacity-50"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveAutomation()}
                      disabled={!canSave || automationSaving}
                      className="rounded-full bg-primary text-on-primary px-lg py-sm text-sm font-semibold disabled:opacity-50"
                    >
                      {automationSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
                {savedNotice && (
                  <p className="text-xs font-semibold text-green-700">
                    Saved.
                  </p>
                )}

                <div className="border-t border-outline-variant/30 pt-lg flex flex-col gap-sm">
                  <div className="flex items-center justify-between gap-md">
                    <h4 className="text-sm font-semibold text-on-surface">History</h4>
                    <span className="font-data-mono text-xs text-outline">
                      {selectedAutomation?.history.length ?? 0}
                    </span>
                  </div>
                  {selectedAutomation?.history.length ? (
                    <div className="rounded-lg border border-outline-variant/40 overflow-hidden">
                      {selectedAutomation.history.map((item) => (
                        <div
                          key={item.id}
                          className="grid sm:grid-cols-[120px_1fr_auto] gap-sm px-md py-sm border-t first:border-t-0 border-outline-variant/20 items-start"
                        >
                          <span
                            className={`w-fit rounded-full px-sm py-0.5 text-[11px] font-semibold ${
                              item.status === "success"
                                ? "bg-green-50 text-green-700 border border-green-200"
                                : item.status === "failed"
                                  ? "bg-error-container/50 text-error border border-error/20"
                                  : "bg-surface-container-high text-on-surface-variant border border-outline-variant"
                            }`}
                          >
                            {item.status}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm text-on-surface truncate">
                              {item.summary ?? "Automation run"}
                            </p>
                            <p className="text-xs text-outline">
                              {formatDashboardTime(item.startedAt)}
                              {item.completedAt ? ` - ${formatDashboardTime(item.completedAt)}` : ""}
                            </p>
                          </div>
                          <span className="font-data-mono text-[11px] text-outline">
                            {item.id.slice(0, 8)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-md py-sm text-sm text-outline">
                      No runs yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function AutomationAvatar({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  return (
    <div className="w-12 h-12 rounded-lg bg-surface-container-high overflow-hidden shrink-0">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-outline">
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
            smart_toy
          </span>
        </div>
      )}
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
