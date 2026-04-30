"use client";

// AgentConsole — uses @0glabs/0g-serving-broker directly in the browser.
// Access control:
//   1. Owner can set up a marketplace rent listing and withdraw earnings.
//   2. Authorized users (owner or renters who paid) can chat with the agent.
//   3. Everyone else sees the rent panel and can pay to get access.
//
// Temporary simulation: private intelligence is encrypted with a server key on
// 0G Storage, then injected server-side after wallet authorization.

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccount, useWalletClient, useBalance, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEventLogs } from "viem";
import { BrowserProvider } from "ethers";
import { buildAuthMessage } from "@/lib/auth";
import {
  INFT_ADDRESS,
  INFT_ABI,
  MARKETPLACE_ADDRESS,
  MARKETPLACE_ABI,
} from "@/lib/contracts";

const PROVIDERS = [
  {
    label: "Qwen 2.5 7B",
    address: "0xa48f01287233509FD694a22Bf840225062E67836",
  },
  {
    label: "GPT-OSS-20B",
    address: "0x8e60d466FD16798Bec4868aa4CE38586D5590049",
  },
  {
    label: "Gemma 3 27B",
    address: "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08",
  },
];

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  tokenId: string;
  agentName: string;
}

interface RentOrder {
  orderId: string;
  pricePerSecond: string;
  maxDuration: number;
}

function isUintString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

// ---- Helper: build auth Bearer token ----
async function buildAuthBearer(
  tokenId: string,
  signer: import("ethers").JsonRpcSigner
): Promise<string> {
  const timestamp = Date.now();
  const message = buildAuthMessage(tokenId, timestamp);
  const signature = await signer.signMessage(message);
  const address = await signer.getAddress();
  const payload = { address, timestamp, signature };
  return "Bearer " + Buffer.from(JSON.stringify(payload)).toString("base64");
}

// ---- Format wei/second → human price string ----
function formatPricePerHour(weiPerSec: string): string {
  try {
    const ogPerHour = (Number(BigInt(weiPerSec) * 3600n) / 1e18).toFixed(4);
    return `${ogPerHour} OG / hour`;
  } catch {
    return "—";
  }
}

// ---- Ledger / Funding Panel ----
function LedgerPanel({
  balance,
  hasLedger,
  loading,
  onDeposit,
  onTransfer,
  providerAddress,
}: {
  balance: number | null;
  hasLedger: boolean | null;
  loading: boolean;
  onDeposit: (amount: number) => void;
  onTransfer: (provider: string, amount: number) => void;
  providerAddress: string;
}) {
  const [depositAmt, setDepositAmt] = useState("3");
  const [transferAmt, setTransferAmt] = useState("1");

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
        <span className="font-data-mono text-data-mono font-bold text-amber-900">
          {balance !== null ? `${balance.toFixed(4)} OG` : "—"}
        </span>
      </div>

      {!hasLedger ? (
        <>
          <p className="font-body-sub text-body-sub text-amber-700 text-xs">
            Create a ledger to start using 0G Compute. Min deposit: 3 OG.
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
              disabled={loading}
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
            Fund this provider sub-account to send queries (min 1 OG). Each query costs ~0.0000001 OG.
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
                onClick={() => onDeposit(parseFloat(depositAmt))} disabled={loading}
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
                onClick={() => onTransfer(providerAddress, parseFloat(transferAmt))} disabled={loading}
                className="bg-amber-600 text-white font-label-caps text-label-caps font-semibold py-xs px-sm rounded-full hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-xs text-xs"
              >
                {loading && <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Transfer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Owner: Rental Setup Panel ----
function OwnerRentalPanel({
  tokenId,
  rentOrder,
  getSigner,
  onOrderUpdated,
}: {
  tokenId: string;
  rentOrder: RentOrder | null;
  getSigner: () => Promise<import("ethers").JsonRpcSigner>;
  onOrderUpdated: () => void;
}) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [priceOgPerHour, setPriceOgPerHour] = useState("1");
  const [maxHours, setMaxHours] = useState("24");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<`0x${string}` | undefined>();

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: pendingTx,
    query: { enabled: !!pendingTx },
  });

  // Read marketplace usage-operator status
  const { data: isUsageOperator } = useReadContract({
    address: INFT_ADDRESS,
    abi: INFT_ABI,
    functionName: "isUsageOperator",
    args: address ? [address, MARKETPLACE_ADDRESS] : undefined,
    query: { enabled: !!address && !!MARKETPLACE_ADDRESS },
  });

  const handleEnableRental = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const signer = await getSigner();

      // Step 1: set marketplace as usage operator (if not already)
      if (!isUsageOperator) {
        const txHash = await writeContractAsync({
          address: INFT_ADDRESS,
          abi: INFT_ABI,
          functionName: "setUsageOperator",
          args: [BigInt(tokenId), MARKETPLACE_ADDRESS, true],
        });
        await signer.provider.waitForTransaction(txHash);
      }

      // Step 2: list rent order
      const pricePerSecond =
        BigInt(Math.round((parseFloat(priceOgPerHour) * 1e18) / 3600));
      const maxDuration = parseInt(maxHours) * 3600;

      const listTxHash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "listRent",
        args: [INFT_ADDRESS, BigInt(tokenId), pricePerSecond, BigInt(maxDuration)],
      });
      setPendingTx(listTxHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [address, tokenId, priceOgPerHour, maxHours, isUsageOperator, getSigner, writeContractAsync]);

  // Parse orderId from receipt and update DB
  useEffect(() => {
    if (!receipt || !pendingTx || !address) return;
    (async () => {
      try {
        const events = parseEventLogs({
          abi: MARKETPLACE_ABI,
          eventName: "RentOrderCreated",
          logs: receipt.logs,
        });
        const event = events.find(
          (item) => item.address.toLowerCase() === MARKETPLACE_ADDRESS.toLowerCase()
        );
        const orderId = event?.args.orderId?.toString();
        if (!orderId) {
          throw new Error("Rent order was created, but the order ID was not found in the receipt.");
        }
        const signer = await getSigner();
        const bearer = await buildAuthBearer(tokenId, signer);
        const pricePerSecond = BigInt(
          Math.round((parseFloat(priceOgPerHour) * 1e18) / 3600)
        ).toString();
        const maxDuration = parseInt(maxHours) * 3600;
        await fetch(`/api/token/${tokenId}/rent-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: bearer },
          body: JSON.stringify({ orderId, pricePerSecond, maxDuration }),
        });
        onOrderUpdated();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setPendingTx(undefined);
      }
    })();
  }, [address, getSigner, maxHours, onOrderUpdated, pendingTx, priceOgPerHour, receipt, tokenId]);

  const handleCancelOrder = useCallback(async () => {
    if (!rentOrder || !address) return;
    setLoading(true);
    setError(null);
    try {
      const signer = await getSigner();
      await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "cancelRent",
        args: [BigInt(rentOrder.orderId)],
      });
      const bearer = await buildAuthBearer(tokenId, signer);
      await fetch(`/api/token/${tokenId}/rent-order`, {
        method: "DELETE",
        headers: { Authorization: bearer },
      });
      onOrderUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rentOrder, address, tokenId, getSigner, writeContractAsync, onOrderUpdated]);

  const handleWithdraw = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "withdraw",
        args: [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [writeContractAsync]);

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-md flex flex-col gap-sm">
      <div className="flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>manage_accounts</span>
        <span className="font-semibold text-on-surface font-body-main text-body-main">Owner Controls</span>
        <span className="ml-auto text-xs font-label-caps text-primary bg-primary/10 rounded-full px-sm py-xs">Owner</span>
      </div>

      {!rentOrder ? (
        <>
          <p className="font-body-sub text-body-sub text-on-surface-variant text-xs">
            Set up a rental listing so others can pay to use this agent.
          </p>
          <div className="flex gap-sm items-center flex-wrap">
            <div className="flex gap-xs items-center">
              <span className="text-on-surface-variant text-xs font-semibold">Price:</span>
              <input
                type="number" min="0.001" step="0.001" value={priceOgPerHour}
                onChange={(e) => setPriceOgPerHour(e.target.value)}
                className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs font-data-mono text-data-mono w-24 focus:outline-none focus:border-primary text-sm"
              />
              <span className="text-outline text-xs">OG/hr</span>
            </div>
            <div className="flex gap-xs items-center">
              <span className="text-on-surface-variant text-xs font-semibold">Max:</span>
              <input
                type="number" min="1" step="1" value={maxHours}
                onChange={(e) => setMaxHours(e.target.value)}
                className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs font-data-mono text-data-mono w-20 focus:outline-none focus:border-primary text-sm"
              />
              <span className="text-outline text-xs">hours</span>
            </div>
            <button
              onClick={handleEnableRental} disabled={loading || !MARKETPLACE_ADDRESS || MARKETPLACE_ADDRESS === "0x"}
              className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-xs px-md rounded-full hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-xs text-xs"
            >
              {loading && <span className="inline-block w-3 h-3 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />}
              Enable Rental
            </button>
          </div>
          {!MARKETPLACE_ADDRESS || MARKETPLACE_ADDRESS === "0x" ? (
            <p className="text-xs text-outline">Set NEXT_PUBLIC_MARKETPLACE_ADDRESS to enable the marketplace.</p>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-xs">
          <div className="flex items-center gap-sm">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="font-body-sub text-body-sub text-on-surface">
              Rent listing active — {formatPricePerHour(rentOrder.pricePerSecond)}
              {rentOrder.maxDuration > 0 ? `, max ${rentOrder.maxDuration / 3600}h` : ""}
            </span>
          </div>
          <div className="flex gap-sm">
            <button
              onClick={handleCancelOrder} disabled={loading}
              className="text-xs text-error border border-error/30 rounded-full px-sm py-xs hover:bg-error/5 transition-colors disabled:opacity-40"
            >
              Cancel listing
            </button>
            <button
              onClick={handleWithdraw} disabled={loading}
              className="text-xs text-primary border border-primary/30 rounded-full px-sm py-xs hover:bg-primary/5 transition-colors disabled:opacity-40 flex items-center gap-xs"
            >
              {loading && <span className="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
              Withdraw earnings
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-error break-all">{error}</p>
      )}
    </div>
  );
}

// ---- Renter: Payment Panel ----
function RentPaymentPanel({
  rentOrder,
  onRented,
}: {
  rentOrder: RentOrder;
  onRented: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const [hours, setHours] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<`0x${string}` | undefined>();

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: pendingTx,
    query: { enabled: !!pendingTx },
  });
  const hasValidOrder =
    isUintString(rentOrder.orderId) && isUintString(rentOrder.pricePerSecond);

  useEffect(() => {
    if (!receipt) return;
    queueMicrotask(() => {
      setLoading(false);
      setPendingTx(undefined);
      onRented();
    });
  }, [receipt, onRented]);

  const totalWei = (() => {
    if (!hasValidOrder) return 0n;
    try {
      const secs = BigInt(Math.round(parseFloat(hours) * 3600));
      return BigInt(rentOrder.pricePerSecond) * secs;
    } catch {
      return 0n;
    }
  })();

  const handleRent = useCallback(async () => {
    if (!hasValidOrder) {
      setError("Rental listing is still syncing. Please try again once the order is available.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const secs = BigInt(Math.round(parseFloat(hours) * 3600));
      const txHash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: MARKETPLACE_ABI,
        functionName: "executeRent",
        args: [BigInt(rentOrder.orderId), secs],
        value: totalWei,
      });
      setPendingTx(txHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [hasValidOrder, hours, rentOrder, totalWei, writeContractAsync]);

  if (!hasValidOrder) {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
        <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>sync</span>
        <p className="font-body-main text-body-main text-on-surface-variant text-center">
          Rental listing is syncing
        </p>
        <p className="font-body-sub text-body-sub text-outline text-center max-w-sm">
          The marketplace order is not available yet. Please wait for the on-chain order to finish syncing.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
      <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>lock</span>
      <p className="font-body-main text-body-main text-on-surface-variant text-center">
        Rent access to use this agent
      </p>
      <div className="w-full max-w-md min-w-[18rem] flex flex-col gap-md">
        <div className="bg-surface-container rounded-xl p-md flex flex-col gap-sm">
          <div className="flex items-center justify-between gap-lg text-sm">
            <span className="text-on-surface-variant shrink-0">Price</span>
            <span className="font-data-mono text-on-surface text-right whitespace-nowrap shrink-0">
              {formatPricePerHour(rentOrder.pricePerSecond)}
            </span>
          </div>
          {rentOrder.maxDuration > 0 && (
            <div className="flex items-center justify-between gap-lg text-sm">
              <span className="text-on-surface-variant shrink-0">Max duration</span>
              <span className="font-data-mono text-on-surface text-right whitespace-nowrap shrink-0">
                {rentOrder.maxDuration / 3600} hours
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-sm">
          <span className="text-on-surface-variant text-sm shrink-0">Rent for</span>
          <input
            type="number" min="1" max={rentOrder.maxDuration > 0 ? rentOrder.maxDuration / 3600 : undefined}
            step="1" value={hours} onChange={(e) => setHours(e.target.value)}
            className="bg-surface-container border border-outline-variant rounded-xl p-sm font-data-mono text-on-surface focus:outline-none focus:border-primary text-sm w-32 shrink-0"
          />
          <span className="text-on-surface-variant text-sm shrink-0">hours</span>
        </div>
        <div className="flex items-center justify-between gap-lg text-sm px-xs">
          <span className="text-on-surface-variant shrink-0">Total</span>
          <span className="font-data-mono font-bold text-on-surface text-right whitespace-nowrap shrink-0">
            {(Number(totalWei) / 1e18).toFixed(6)} OG
          </span>
        </div>
        <button
          onClick={handleRent} disabled={loading || !hours || parseFloat(hours) <= 0}
          className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-md px-xl rounded-full hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-sm"
        >
          {loading && <span className="inline-block w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />}
          {pendingTx ? "Confirming…" : "Rent Access"}
        </button>
      </div>
      {error && <p className="text-xs text-error break-all text-center max-w-xs">{error}</p>}
    </div>
  );
}

// ---- Main Console ----
export default function AgentConsole({ tokenId, agentName }: Props) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { data: balanceData } = useBalance({ address });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);

  const [ledgerBalance, setLedgerBalance] = useState<number | null>(null);
  const [hasLedger, setHasLedger] = useState<boolean | null>(null);
  const [fundLoading, setFundLoading] = useState(false);

  // Access state
  const [isOwner, setIsOwner] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [rentOrder, setRentOrder] = useState<RentOrder | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

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

  // Check authorization status
  const refreshAccess = useCallback(async () => {
    if (!address) return;
    setAccessLoading(true);
    try {
      const res = await fetch(
        `/api/token/${tokenId}/access?address=${encodeURIComponent(address)}`
      );
      const data = await res.json() as { isOwner: boolean; isAuthorized: boolean; rentOrder: RentOrder | null };
      setIsOwner(data.isOwner);
      setIsAuthorized(data.isAuthorized);
      setRentOrder(data.rentOrder);
    } catch { /* ignore */ } finally {
      setAccessLoading(false);
    }
  }, [address, tokenId]);

  useEffect(() => {
    if (!isConnected || !address) return;
    queueMicrotask(() => {
      void refreshAccess();
    });
  }, [isConnected, address, refreshAccess]);

  // Ledger
  const refreshLedger = useCallback(async () => {
    if (!isConnected) return;
    try {
      const broker = await getBroker();
      const info = await broker.ledger.getLedger();
      if (info && (info as unknown[]).length > 0) {
        const balWei = BigInt(String((info as unknown[])[0]));
        setLedgerBalance(Number(balWei) / 1e18);
        setHasLedger(true);
      } else {
        setLedgerBalance(0); setHasLedger(false);
      }
    } catch { setLedgerBalance(0); setHasLedger(false); }
  }, [isConnected, getBroker]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshLedger();
    });
  }, [refreshLedger]);

  const handleDeposit = useCallback(async (amount: number) => {
    setFundLoading(true); setError(null);
    try { const broker = await getBroker(); await broker.ledger.depositFund(amount); await refreshLedger(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setFundLoading(false); }
  }, [getBroker, refreshLedger]);

  const handleTransfer = useCallback(async (providerAddr: string, amount: number) => {
    setFundLoading(true); setError(null);
    try {
      const broker = await getBroker();
      await broker.ledger.transferFund(providerAddr, "inference", BigInt(Math.round(amount * 1e18)));
      await refreshLedger();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setFundLoading(false); }
  }, [getBroker, refreshLedger]);

  // Send message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending || !address) return;
    const query = input.trim();
    setInput(""); setSending(true); setError(null);

    const newMessages: Message[] = [...messages, { role: "user", content: query }];
    setMessages(newMessages);

    try {
      const signer = await getSigner();
      const bearer = await buildAuthBearer(tokenId, signer);
      const broker = await getBroker();
      const servingHeaders = await broker.inference.getRequestHeaders(selectedProvider.address);
      const response = await fetch(`/api/token/${tokenId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearer,
        },
        body: JSON.stringify({
          providerAddress: selectedProvider.address,
          servingHeaders,
          messages: newMessages,
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        content?: string;
        chatID?: string | null;
        usage?: unknown;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "0G Compute request failed");
      }
      const content = data?.content ?? "";
      if (data?.chatID) {
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
  }, [address, input, sending, messages, tokenId, getSigner, getBroker, selectedProvider, refreshLedger]);

  // ---- Not connected ----
  if (!isConnected) {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
        <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>chat</span>
        <p className="font-body-main text-body-main text-on-surface-variant text-center">
          Connect your wallet to interact with <strong>{agentName}</strong>
        </p>
        <ConnectButton />
      </div>
    );
  }

  // ---- Loading access ----
  if (accessLoading) {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
        <span className="inline-block w-8 h-8 border-2 border-outline/30 border-t-outline rounded-full animate-spin" />
        <p className="font-body-sub text-body-sub text-outline">Checking access…</p>
      </div>
    );
  }

  // ---- Unauthorized + no rent order ----
  if (!isAuthorized && !rentOrder) {
    return (
      <div className="flex flex-col gap-lg">
        {isOwner && (
          <OwnerRentalPanel
            tokenId={tokenId} rentOrder={null} getSigner={getSigner}
            onOrderUpdated={refreshAccess}
          />
        )}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
          <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>lock</span>
          <p className="font-body-main text-body-main text-on-surface-variant text-center">
            Access to this agent is restricted. The owner has not set up a public rental listing.
          </p>
        </div>
      </div>
    );
  }

  // ---- Unauthorized + rent order available ----
  if (!isAuthorized && rentOrder) {
    return (
      <div className="flex flex-col gap-lg">
        <RentPaymentPanel
          rentOrder={rentOrder}
          onRented={() => {
            void refreshAccess();
          }}
        />
      </div>
    );
  }

  // ---- Authorized (owner or renter) ----
  return (
    <div className="flex flex-col gap-lg">
      {/* Owner controls */}
      {isOwner && (
        <OwnerRentalPanel
          tokenId={tokenId} rentOrder={rentOrder} getSigner={getSigner}
          onOrderUpdated={refreshAccess}
        />
      )}

      {/* Chat console */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-[0px_4px_20px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30">
          <div className="flex items-center gap-sm">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">
              Interact via 0G Compute
            </span>
            {isOwner
              ? <span className="text-xs font-label-caps text-primary bg-primary/10 rounded-full px-sm py-xs">Owner</span>
              : <span className="text-xs font-label-caps text-green-700 bg-green-50 rounded-full px-sm py-xs">Authorized</span>
            }
          </div>
          <div className="flex items-center gap-sm">
            {balanceData && (
              <span className="font-data-mono text-data-mono text-on-surface-variant text-xs">
                {(Number(balanceData.value) / 1e18).toFixed(4)} {balanceData.symbol}
              </span>
            )}
            <select
              value={selectedProvider.address}
              onChange={(e) => setSelectedProvider(PROVIDERS.find((p) => p.address === e.target.value) ?? PROVIDERS[0])}
              className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs text-sm text-on-surface focus:outline-none focus:border-primary"
            >
              {PROVIDERS.map((p) => (
                <option key={p.address} value={p.address}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Ledger panel */}
        <div className="px-lg pt-md">
          <LedgerPanel
            balance={ledgerBalance} hasLedger={hasLedger} loading={fundLoading}
            onDeposit={handleDeposit} onTransfer={handleTransfer}
            providerAddress={selectedProvider.address}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md min-h-[300px] max-h-[480px]">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-sm text-outline">
              <span className="material-symbols-outlined" style={{ fontSize: 40 }}>smart_toy</span>
              <p className="font-body-sub text-body-sub text-center">
                Start a conversation with <strong className="text-on-surface-variant">{agentName}</strong>
              </p>
              <p className="font-body-sub text-body-sub text-center text-xs text-outline/70">
                The server verifies your wallet and keeps private agent instructions out of the browser.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-md py-sm font-body-main text-body-main leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-on-primary rounded-br-sm"
                  : "bg-surface-container text-on-surface rounded-bl-sm"
              }`}>{m.content}</div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-surface-container rounded-2xl rounded-bl-sm px-md py-sm flex items-center gap-xs">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="w-2 h-2 bg-outline rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
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
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={hasLedger === false ? "Create a ledger above to start chatting" : "Type a message… (Enter to send)"}
            rows={1} disabled={sending || hasLedger === false}
            className="flex-1 bg-surface-container rounded-xl px-md py-sm font-body-main text-body-main text-on-surface placeholder:text-outline resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 border border-outline-variant disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            onClick={sendMessage} disabled={sending || !input.trim() || hasLedger === false}
            className="bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity flex-shrink-0"
          >
            {sending
              ? <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
              : <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
