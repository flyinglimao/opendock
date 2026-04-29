"use client";

// AgentConsole — uses @0glabs/0g-serving-broker directly in the browser.
// The user's own wallet (via wagmi/BrowserProvider) signs all on-chain transactions.
// Official browser flow: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccount, useWalletClient, useBalance } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BrowserProvider } from "ethers";

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
  systemPrompt: string;
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
          <span
            className="material-symbols-outlined text-amber-600"
            style={{ fontSize: 18 }}
          >
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
              type="number"
              min="3"
              step="1"
              value={depositAmt}
              onChange={(e) => setDepositAmt(e.target.value)}
              className="bg-white border border-amber-300 rounded-lg px-sm py-xs font-data-mono text-data-mono w-24 focus:outline-none focus:border-amber-500"
            />
            <span className="text-amber-700 text-sm">OG</span>
            <button
              onClick={() => onDeposit(parseFloat(depositAmt))}
              disabled={loading}
              className="bg-amber-600 text-white font-label-caps text-label-caps font-semibold py-xs px-md rounded-full hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-xs"
            >
              {loading && (
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              Create Ledger
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-body-sub text-body-sub text-amber-600 text-xs">
            Fund this provider sub-account to send queries (min 1 OG). Each
            query costs ~0.0000001 OG.
          </p>
          <div className="flex gap-sm items-center flex-wrap">
            <div className="flex gap-sm items-center">
              <span className="text-amber-700 text-xs font-semibold">
                Top-up ledger:
              </span>
              <input
                type="number"
                min="1"
                step="1"
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                className="bg-white border border-amber-300 rounded-lg px-sm py-xs font-data-mono text-data-mono w-20 focus:outline-none focus:border-amber-500"
              />
              <span className="text-amber-700 text-xs">OG</span>
              <button
                onClick={() => onDeposit(parseFloat(depositAmt))}
                disabled={loading}
                className="bg-amber-100 text-amber-800 border border-amber-400 font-label-caps text-label-caps font-semibold py-xs px-sm rounded-full hover:bg-amber-200 transition-colors disabled:opacity-50 text-xs"
              >
                Deposit
              </button>
            </div>
            <div className="flex gap-sm items-center">
              <span className="text-amber-700 text-xs font-semibold">
                Fund provider:
              </span>
              <input
                type="number"
                min="1"
                step="1"
                value={transferAmt}
                onChange={(e) => setTransferAmt(e.target.value)}
                className="bg-white border border-amber-300 rounded-lg px-sm py-xs font-data-mono text-data-mono w-20 focus:outline-none focus:border-amber-500"
              />
              <span className="text-amber-700 text-xs">OG</span>
              <button
                onClick={() =>
                  onTransfer(providerAddress, parseFloat(transferAmt))
                }
                disabled={loading}
                className="bg-amber-600 text-white font-label-caps text-label-caps font-semibold py-xs px-sm rounded-full hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-xs text-xs"
              >
                {loading && (
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Transfer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AgentConsole({ agentName, systemPrompt }: Props) {
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

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build ethers signer from wagmi wallet client
  const getSigner = useCallback(async () => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const provider = new BrowserProvider(walletClient.transport);
    return provider.getSigner();
  }, [walletClient, address]);

  // Build 0G broker
  const getBroker = useCallback(async () => {
    const signer = await getSigner();
    const { createZGComputeNetworkBroker } = await import(
      "@0glabs/0g-serving-broker"
    );
    return createZGComputeNetworkBroker(signer);
  }, [getSigner]);

  // Check / refresh ledger balance
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
        setLedgerBalance(0);
        setHasLedger(false);
      }
    } catch {
      setLedgerBalance(0);
      setHasLedger(false);
    }
  }, [isConnected, getBroker]);

  useEffect(() => {
    refreshLedger();
  }, [refreshLedger]);

  // Create ledger / top-up
  const handleDeposit = useCallback(
    async (amount: number) => {
      setFundLoading(true);
      setError(null);
      try {
        const broker = await getBroker();
        await broker.ledger.depositFund(amount);
        await refreshLedger();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setFundLoading(false);
      }
    },
    [getBroker, refreshLedger]
  );

  // Transfer from ledger to provider sub-account
  const handleTransfer = useCallback(
    async (providerAddr: string, amount: number) => {
      setFundLoading(true);
      setError(null);
      try {
        const broker = await getBroker();
        // transferFund also auto-acknowledges the provider signer
        await broker.ledger.transferFund(
          providerAddr,
          "inference",
          BigInt(Math.round(amount * 1e18))
        );
        await refreshLedger();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setFundLoading(false);
      }
    },
    [getBroker, refreshLedger]
  );

  // Send a chat message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return;
    const query = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: query },
    ];
    setMessages(newMessages);

    try {
      const broker = await getBroker();
      const { endpoint, model } = await broker.inference.getServiceMetadata(
        selectedProvider.address
      );
      const headers = await broker.inference.getRequestHeaders(
        selectedProvider.address
      );

      const chatMessages = [
        ...(systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
        ...newMessages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(headers as unknown as Record<string, string>),
        },
        body: JSON.stringify({ messages: chatMessages, model }),
      });

      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
        id?: string;
        chatID?: string;
      };
      const content = data.choices?.[0]?.message?.content ?? "";

      // Optional TEE verification
      const chatID =
        response.headers.get("ZG-Res-Key") ||
        response.headers.get("zg-res-key") ||
        data.id ||
        data.chatID;
      if (chatID) {
        await broker.inference.processResponse(
          selectedProvider.address,
          chatID
        );
      }

      setMessages([...newMessages, { role: "assistant", content }]);
      await refreshLedger();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages([
        ...newMessages,
        { role: "assistant", content: `⚠️ ${msg}` },
      ]);
    } finally {
      setSending(false);
    }
  }, [
    input,
    sending,
    messages,
    selectedProvider,
    systemPrompt,
    getBroker,
    refreshLedger,
  ]);

  // ---- Not connected ----
  if (!isConnected) {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
        <span
          className="material-symbols-outlined text-outline"
          style={{ fontSize: 40 }}
        >
          chat
        </span>
        <p className="font-body-main text-body-main text-on-surface-variant text-center">
          Connect your wallet to chat with <strong>{agentName}</strong> via 0G
          Compute
        </p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-[0px_4px_20px_rgba(0,0,0,0.05)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30">
        <div className="flex items-center gap-sm">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="font-label-caps text-label-caps font-semibold text-on-surface">
            Interact via 0G Compute
          </span>
        </div>
        <div className="flex items-center gap-sm">
          {balanceData && (
            <span className="font-data-mono text-data-mono text-on-surface-variant text-xs">
              {(Number(balanceData.value) / 1e18).toFixed(4)} {balanceData.symbol}
            </span>
          )}
          <select
            value={selectedProvider.address}
            onChange={(e) =>
              setSelectedProvider(
                PROVIDERS.find((p) => p.address === e.target.value) ??
                  PROVIDERS[0]
              )
            }
            className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs text-sm text-on-surface focus:outline-none focus:border-primary"
          >
            {PROVIDERS.map((p) => (
              <option key={p.address} value={p.address}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ledger panel */}
      <div className="px-lg pt-md">
        <LedgerPanel
          balance={ledgerBalance}
          hasLedger={hasLedger}
          loading={fundLoading}
          onDeposit={handleDeposit}
          onTransfer={handleTransfer}
          providerAddress={selectedProvider.address}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md min-h-[300px] max-h-[480px]">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-sm text-outline">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 40 }}
            >
              smart_toy
            </span>
            <p className="font-body-sub text-body-sub text-center">
              Start a conversation with{" "}
              <strong className="text-on-surface-variant">{agentName}</strong>
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-md py-sm font-body-main text-body-main leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-on-primary rounded-br-sm"
                  : "bg-surface-container text-on-surface rounded-bl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-surface-container rounded-2xl rounded-bl-sm px-md py-sm flex items-center gap-xs">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="w-2 h-2 bg-outline rounded-full animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-lg mb-sm bg-red-50 border border-red-200 rounded-lg px-md py-sm">
          <p className="font-body-sub text-body-sub text-red-600 break-all">
            {error}
          </p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400 underline mt-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-outline-variant/30 px-lg py-md flex gap-sm items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            hasLedger === false
              ? "Create a ledger above to start chatting"
              : "Type a message… (Enter to send)"
          }
          rows={1}
          disabled={sending || hasLedger === false}
          className="flex-1 bg-surface-container rounded-xl px-md py-sm font-body-main text-body-main text-on-surface placeholder:text-outline resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 border border-outline-variant disabled:opacity-50 max-h-32 overflow-y-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          onClick={sendMessage}
          disabled={sending || !input.trim() || hasLedger === false}
          className="bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {sending ? (
            <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
          ) : (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20 }}
            >
              send
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
