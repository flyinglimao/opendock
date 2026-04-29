"use client";

// AgentConsole — all 0G Compute calls go through Next.js API routes.
// The browser never imports @0glabs/0g-serving-broker directly.
// The broker runs server-side; the user's wallet signs a message to prove identity,
// and the API routes use that to authorize requests.
//
// NOTE: Because 0G serving-broker requires an ethers.Signer with a private key to sign
// transactions (on-chain ledger ops), and we cannot expose the user's private key to
// the server, the MVP flow is:
//   - Ledger creation / deposit → user wallet signs directly via wagmi (on-chain tx)
//   - Inference queries → proxied through /api/compute/query using a server wallet
//     (NEXT_PUBLIC_COMPUTE_PROVIDER_PK env var — operator's key, not the user's)
//
// For a production system, implement a proper auth flow (e.g. sign-in-with-ethereum).

import { useState, useRef, useCallback, useEffect } from "react";
import { useAccount, useBalance } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const PROVIDERS = [
  { label: "Qwen 2.5 7B", address: "0xa48f01287233509FD694a22Bf840225062E67836", model: "qwen/qwen-2.5-7b-instruct" },
  { label: "GPT-OSS-20B", address: "0x8e60d466FD16798Bec4868aa4CE38586D5590049", model: "openai/gpt-oss-20b" },
  { label: "Gemma 3 27B", address: "0x69Eb5a0BD7d0f4bF39eD5CE9Bd3376c61863aE08", model: "google/gemma-3-27b-it" },
];

interface Message { role: "user" | "assistant"; content: string }
interface Props { tokenId: string; agentName: string; systemPrompt: string }

function LedgerPanel({ balance, loading, onRefresh }: { balance: number | null; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-md flex flex-col gap-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 18 }}>account_balance_wallet</span>
          <span className="font-semibold text-amber-800 font-body-main text-body-main">0G Compute Ledger</span>
        </div>
        <div className="flex items-center gap-sm">
          <span className="font-data-mono text-data-mono font-bold text-amber-900">
            {balance !== null ? `${balance.toFixed(4)} OG` : "—"}
          </span>
          <button onClick={onRefresh} disabled={loading}
            className="text-amber-600 hover:text-amber-800 transition-colors disabled:opacity-50">
            <span className={`material-symbols-outlined ${loading ? "animate-spin" : ""}`} style={{ fontSize: 16 }}>refresh</span>
          </button>
        </div>
      </div>
      <p className="font-body-sub text-body-sub text-amber-600 text-xs">
        To deposit OG tokens for compute, use the{" "}
        <a href="https://0g.ai" target="_blank" rel="noopener noreferrer" className="underline">0G dashboard</a>
        {" "}or the{" "}
        <a href={`https://chainscan-galileo.0g.ai`} target="_blank" rel="noopener noreferrer" className="underline">block explorer</a>.
        {" "}Min 3 OG to create ledger · queries cost ~0.0000001 OG each.
      </p>
    </div>
  );
}

export default function AgentConsole({ agentName, systemPrompt }: Props) {
  const { address, isConnected } = useAccount();
  const { data: balanceData } = useBalance({ address });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);
  const [ledgerBalance, setLedgerBalance] = useState<number | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const refreshLedger = useCallback(async () => {
    if (!isConnected) return;
    setLedgerLoading(true);
    try {
      const res = await fetch("/api/compute/ledger");
      if (res.ok) {
        const data = await res.json() as { balance: number };
        setLedgerBalance(data.balance);
      }
    } catch { /* ignore */ }
    finally { setLedgerLoading(false); }
  }, [isConnected]);

  useEffect(() => { refreshLedger(); }, [refreshLedger]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return;
    const query = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    const newMessages: Message[] = [...messages, { role: "user", content: query }];
    setMessages(newMessages);

    try {
      const chatMessages = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...newMessages.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
      ];

      const res = await fetch("/api/compute/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAddress: selectedProvider.address, messages: chatMessages }),
      });

      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error);
      }

      const { content } = await res.json() as { content: string };
      setMessages([...newMessages, { role: "assistant", content }]);
      await refreshLedger();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages([...newMessages, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, selectedProvider, systemPrompt, refreshLedger]);

  if (!isConnected) {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-xl flex flex-col items-center gap-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
        <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>chat</span>
        <p className="font-body-main text-body-main text-on-surface-variant text-center">
          Connect your wallet to chat with <strong>{agentName}</strong> via 0G Compute
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
          <span className="font-label-caps text-label-caps font-semibold text-on-surface">Interact via 0G Compute</span>
        </div>
        <div className="flex items-center gap-sm">
          {balanceData && (
            <span className="font-data-mono text-data-mono text-on-surface-variant text-xs">
              {(Number(balanceData.value) / 1e18).toFixed(4)} {balanceData.symbol}
            </span>
          )}
          <select value={selectedProvider.address}
            onChange={(e) => setSelectedProvider(PROVIDERS.find((p) => p.address === e.target.value) ?? PROVIDERS[0])}
            className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs text-sm text-on-surface focus:outline-none focus:border-primary">
            {PROVIDERS.map((p) => <option key={p.address} value={p.address}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {/* Ledger panel */}
      <div className="px-lg pt-md">
        <LedgerPanel balance={ledgerBalance} loading={ledgerLoading} onRefresh={refreshLedger} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md min-h-[300px] max-h-[480px]">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-sm text-outline">
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>smart_toy</span>
            <p className="font-body-sub text-body-sub text-center">
              Start a conversation with <strong className="text-on-surface-variant">{agentName}</strong>
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-md py-sm font-body-main text-body-main leading-relaxed whitespace-pre-wrap ${
              m.role === "user" ? "bg-primary text-on-primary rounded-br-sm" : "bg-surface-container text-on-surface rounded-bl-sm"
            }`}>
              {m.content}
            </div>
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
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Type a message… (Enter to send)"
          rows={1} disabled={sending}
          className="flex-1 bg-surface-container rounded-xl px-md py-sm font-body-main text-body-main text-on-surface placeholder:text-outline resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 border border-outline-variant disabled:opacity-50 max-h-32 overflow-y-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button onClick={sendMessage} disabled={sending || !input.trim()}
          className="bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity flex-shrink-0">
          {sending
            ? <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
            : <span className="material-symbols-outlined" style={{ fontSize: 20 }}>send</span>
          }
        </button>
      </div>
    </div>
  );
}
