"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { loadMintedTokens, type MintedToken } from "@/app/create/CreateAgentForm";

// ---- Token status (polled from /api/token/[id]/status) ----
type TokenStatus =
  | { state: "loading" }
  | { state: "syncing" }
  | { state: "ready"; name: string; description?: string; image?: string }
  | { state: "error" };

function useTokenStatus(tokenId: string): TokenStatus {
  const [status, setStatus] = useState<TokenStatus>({ state: "loading" });

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/token/${tokenId}/status`, { cache: "no-store" });
      const data = (await res.json()) as {
        available: boolean;
        name?: string;
        description?: string;
        image?: string;
      };
      if (data.available) {
        setStatus({ state: "ready", name: data.name ?? `Agent #${tokenId}`, description: data.description, image: data.image });
      } else {
        setStatus({ state: "syncing" });
      }
    } catch {
      setStatus({ state: "error" });
    }
  }, [tokenId]);

  useEffect(() => {
    queueMicrotask(() => {
      void check();
    });
    // Poll every 15 s while syncing
    const interval = setInterval(() => {
      setStatus((s) => {
        if (s.state === "ready") { clearInterval(interval); return s; }
        return s;
      });
      void check();
    }, 15000);
    return () => clearInterval(interval);
  }, [check]);

  return status;
}

// ---- Single agent card ----
function AgentCard({ token }: { token: MintedToken }) {
  const status = useTokenStatus(token.tokenId);
  const displayName =
    status.state === "ready" ? status.name : token.name || `Agent #${token.tokenId}`;

  return (
    <div className="bg-surface rounded-xl border border-outline-variant shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-shadow flex flex-col h-64 overflow-hidden">
      {/* Image or placeholder */}
      <div className="h-24 bg-surface-container-low flex items-center justify-center flex-shrink-0 relative overflow-hidden">
        {status.state === "ready" && status.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={status.image} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <span className="material-symbols-outlined text-outline" style={{ fontSize: 40 }}>
            smart_toy
          </span>
        )}
        {/* Status badge */}
        <div className="absolute top-2 right-2">
          {status.state === "ready" && (
            <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-outline-variant px-2 py-0.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="font-label-caps text-label-caps font-semibold text-green-700 text-[10px]">Live</span>
            </div>
          )}
          {status.state === "syncing" && (
            <div className="flex items-center gap-1.5 bg-amber-50/90 backdrop-blur-sm border border-amber-200 px-2 py-0.5 rounded-full">
              <span className="inline-block w-1.5 h-1.5 border border-amber-400 border-t-amber-600 rounded-full animate-spin" />
              <span className="font-label-caps text-label-caps font-semibold text-amber-700 text-[10px]">Syncing</span>
            </div>
          )}
          {status.state === "loading" && (
            <div className="flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border border-outline-variant px-2 py-0.5 rounded-full">
              <span className="inline-block w-1.5 h-1.5 border border-outline border-t-primary rounded-full animate-spin" />
              <span className="font-label-caps text-label-caps font-semibold text-outline text-[10px]">Checking</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-md gap-xs overflow-hidden">
        <div className="flex items-start justify-between gap-sm">
          <h2 className="font-h2 text-h2 font-semibold text-on-surface truncate">{displayName}</h2>
          <span className="font-data-mono text-data-mono text-outline text-xs flex-shrink-0">#{token.tokenId}</span>
        </div>
        {status.state === "ready" && status.description && (
          <p className="font-body-sub text-body-sub text-on-surface-variant line-clamp-2">{status.description}</p>
        )}
        {status.state === "syncing" && (
          <p className="font-body-sub text-body-sub text-amber-600 text-xs">
            0G Storage is syncing… auto-checking every 15s
          </p>
        )}
        {/* Footer */}
        <div className="mt-auto pt-xs border-t border-outline-variant/30 flex items-center justify-between">
          <span className="font-data-mono text-data-mono text-outline text-[10px]">
            {new Date(token.mintedAt).toLocaleDateString()}
          </span>
          {status.state === "ready" ? (
            <Link
              href={`/agents/${token.tokenId}`}
              className="font-label-caps text-label-caps font-semibold text-primary hover:underline text-xs"
            >
              Open →
            </Link>
          ) : (
            <a
              href={`https://chainscan-galileo.0g.ai/tx/${token.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-label-caps text-label-caps font-semibold text-outline hover:underline text-xs"
            >
              Tx ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Main tab component ----
export default function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<"assets" | "automations">("assets");
  const [tokens, setTokens] = useState<MintedToken[]>([]);

  useEffect(() => {
    queueMicrotask(() => {
      setTokens(loadMintedTokens());
    });
  }, []);

  return (
    <div className="flex flex-col gap-lg">
      {/* Tab Navigation */}
      <div className="flex items-center gap-8 border-b border-outline-variant overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab("assets")}
          className={`pb-3 border-b-2 font-body-main text-body-main flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeTab === "assets"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-on-surface-variant hover:text-on-background"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>
            grid_view
          </span>
          My Agents
          {tokens.length > 0 && (
            <span className="bg-surface-container text-on-surface-variant font-data-mono text-data-mono text-xs px-1.5 py-0.5 rounded-full">
              {tokens.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("automations")}
          className={`pb-3 border-b-2 font-body-main text-body-main flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeTab === "automations"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-on-surface-variant hover:text-on-background"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>
            auto_awesome
          </span>
          Automations
        </button>
      </div>

      {activeTab === "assets" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
          {tokens.map((t) => (
            <AgentCard key={t.tokenId} token={t} />
          ))}

          {/* Deploy new */}
          <Link
            href="/create"
            className="bg-surface-container-low rounded-xl border border-dashed border-outline-variant hover:border-primary hover:bg-surface-container transition-all flex flex-col items-center justify-center h-64 gap-4 group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-surface-bright flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 0" }}>
                add
              </span>
            </div>
            <span className="font-h2 text-h2 font-semibold text-on-surface-variant group-hover:text-primary transition-colors">
              Deploy New Agent
            </span>
          </Link>
        </div>
      )}

      {activeTab === "automations" && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl" style={{ fontVariationSettings: "'FILL' 0" }}>
            auto_awesome
          </span>
          <p className="font-body-main text-body-main">No automations configured yet.</p>
          <Link
            href="/create"
            className="bg-primary text-on-primary px-6 py-2 rounded-lg font-label-caps text-label-caps font-semibold hover:opacity-90 transition-opacity"
          >
            Create Automation
          </Link>
        </div>
      )}
    </div>
  );
}
