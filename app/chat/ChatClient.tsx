"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BrowserProvider } from "ethers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { buildAuthMessage, buildSessionAuthMessage } from "@/lib/auth";
import { COMPUTE_PROVIDERS, type ComputeProvider } from "@/lib/compute-providers";

interface ConversationSummary {
  id: string;
  tokenId: string;
  title: string | null;
  providerAddress: string | null;
  lastMessageAt: string;
  messageCount: number;
  preview: string;
  previewRole: "user" | "assistant" | null;
  agent: {
    name: string;
    image: string | null;
    description: string | null;
  };
}

interface ConversationDetail extends ConversationSummary {
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    sequence: number;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
}

interface AvailableAgent {
  tokenId: string;
  name: string | null;
  description: string | null;
  image: string | null;
  activeRental: boolean;
}

interface ChatAgent {
  tokenId: string;
  name: string;
  image: string | null;
  description: string | null;
}

interface ConversationsResponse {
  conversations?: ConversationSummary[];
  nextCursor?: string | null;
  error?: string;
}

interface ConversationResponse {
  conversation?: ConversationDetail;
  error?: string;
}

interface DashboardAgentsResponse {
  owned?: AvailableAgent[];
  rented?: AvailableAgent[];
  error?: string;
}

type ComputeWalletMode = "hosted" | "user";

const SESSION_BEARER_CACHE_MS = 25 * 60 * 1000;

async function buildSessionBearer(
  signer: import("ethers").JsonRpcSigner
): Promise<string> {
  const address = await signer.getAddress();
  const cacheKey = `opendock.session.${address.toLowerCase()}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        address: string;
        bearer: string;
        timestamp: number;
      };
      if (
        parsed.address.toLowerCase() === address.toLowerCase() &&
        Date.now() - parsed.timestamp < SESSION_BEARER_CACHE_MS
      ) {
        return parsed.bearer;
      }
    }
  } catch {
    // Session storage is just a convenience cache.
  }

  const timestamp = Date.now();
  const signature = await signer.signMessage(buildSessionAuthMessage(timestamp));
  const payload = { address, timestamp, signature };
  const bearer = `Bearer ${btoa(JSON.stringify(payload))}`;
  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ address, bearer, timestamp })
    );
  } catch {
    // Ignore cache failures.
  }
  return bearer;
}

async function buildTokenBearer(
  tokenId: string,
  signer: import("ethers").JsonRpcSigner
): Promise<string> {
  const address = await signer.getAddress();
  const cacheKey = `opendock.auth.${tokenId}.${address.toLowerCase()}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        address: string;
        bearer: string;
        timestamp: number;
      };
      if (
        parsed.address.toLowerCase() === address.toLowerCase() &&
        Date.now() - parsed.timestamp < SESSION_BEARER_CACHE_MS
      ) {
        return parsed.bearer;
      }
    }
  } catch {
    // Ignore cache failures.
  }

  const timestamp = Date.now();
  const signature = await signer.signMessage(buildAuthMessage(tokenId, timestamp));
  const payload = { address, timestamp, signature };
  const bearer = `Bearer ${btoa(JSON.stringify(payload))}`;
  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ address, bearer, timestamp })
    );
  } catch {
    // Ignore cache failures.
  }
  return bearer;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dedupeConversations(items: ConversationSummary[]): ConversationSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function EmptyWindow({
  agents,
  loading,
  error,
  onRefresh,
  onSelectAgent,
}: {
  agents: AvailableAgent[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectAgent: (agent: AvailableAgent) => void;
}) {
  return (
    <div className="h-full min-h-[420px] bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden">
      <div className="px-lg py-md border-b border-outline-variant/30 flex items-center justify-between gap-md">
        <div>
          <h2 className="font-h2 text-h2 font-semibold text-on-surface">
            Start a chat
          </h2>
          <p className="font-body-sub text-body-sub text-on-surface-variant mt-xs">
            Select an available agent or open a previous conversation.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh agents"
          aria-label="Refresh agents"
          className="w-9 h-9 rounded-lg border border-outline-variant bg-surface-container text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50 flex items-center justify-center"
        >
          <span className={`material-symbols-outlined ${loading ? "animate-spin" : ""}`} style={{ fontSize: 19 }}>
            refresh
          </span>
        </button>
      </div>
      <div className="p-lg">
        {loading ? (
          <div className="grid sm:grid-cols-2 gap-sm">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-24 rounded-lg bg-surface-container animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-md py-sm text-red-700">
            <p className="font-body-sub text-body-sub break-all">{error}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs underline underline-offset-2 mt-xs"
            >
              Retry
            </button>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-sm py-xl text-outline">
            <span className="material-symbols-outlined" style={{ fontSize: 42 }}>
              smart_toy
            </span>
            <p className="font-body-sub text-body-sub">
              No available agents yet.
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-sm">
            {agents.map((agent) => (
              <button
                key={agent.tokenId}
                type="button"
                onClick={() => onSelectAgent(agent)}
                className="text-left rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-sm flex gap-sm hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-surface-container-high overflow-hidden shrink-0">
                  {agent.image ? (
                    <Image
                      src={agent.image}
                      alt={agent.name ?? `Agent #${agent.tokenId}`}
                      width={48}
                      height={48}
                      unoptimized
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-outline">
                      <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                        smart_toy
                      </span>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-on-surface truncate">
                    {agent.name ?? `Agent #${agent.tokenId}`}
                  </div>
                  <div className="text-xs text-outline mt-0.5">
                    {agent.activeRental ? "Rented" : "Owned"}
                  </div>
                  <div className="text-xs text-on-surface-variant truncate mt-xs">
                    {agent.description ?? "Ready to chat"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="h-full min-h-[420px] bg-surface-container-lowest border border-outline-variant/40 rounded-xl p-lg animate-pulse">
      <div className="flex items-center gap-md border-b border-outline-variant/30 pb-md">
        <div className="w-12 h-12 rounded-lg bg-surface-container-high" />
        <div className="flex-1 flex flex-col gap-sm">
          <div className="h-4 rounded bg-surface-container-high w-48" />
          <div className="h-3 rounded bg-surface-container-high w-32" />
        </div>
      </div>
      <div className="flex flex-col gap-md pt-lg">
        <div className="h-16 rounded-2xl bg-surface-container-high w-3/4 ml-auto" />
        <div className="h-20 rounded-2xl bg-surface-container-high w-4/5" />
        <div className="h-14 rounded-2xl bg-surface-container-high w-2/3 ml-auto" />
      </div>
    </div>
  );
}

export default function ChatClient({
  selectedConversationId,
}: {
  selectedConversationId: string | null;
}) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [draftAgent, setDraftAgent] = useState<ChatAgent | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ComputeProvider>(COMPUTE_PROVIDERS[0]);
  const [computeWalletMode, setComputeWalletMode] = useState<ComputeWalletMode>("hosted");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRequestRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);

  const getSessionBearer = useCallback(async () => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const provider = new BrowserProvider(walletClient.transport);
    const signer = await provider.getSigner();
    return buildSessionBearer(signer);
  }, [address, walletClient]);

  const getSigner = useCallback(async () => {
    if (!walletClient || !address) throw new Error("Wallet not connected");
    const provider = new BrowserProvider(walletClient.transport);
    return provider.getSigner();
  }, [address, walletClient]);

  const getBroker = useCallback(async () => {
    const signer = await getSigner();
    const { createZGComputeNetworkBroker } = await import("@0glabs/0g-serving-broker");
    return createZGComputeNetworkBroker(signer);
  }, [getSigner]);

  const loadAvailableAgents = useCallback(async () => {
    if (!address || !isConnected) return;
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const res = await fetch(
        `/api/dashboard/agents?address=${encodeURIComponent(address)}`
      );
      const data = (await res.json().catch(() => null)) as
        | DashboardAgentsResponse
        | null;
      if (!res.ok || !data) {
        throw new Error(data?.error ?? "Failed to load available agents");
      }
      setAvailableAgents([...(data.owned ?? []), ...(data.rented ?? [])]);
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : String(err));
      setAvailableAgents([]);
    } finally {
      setAgentsLoading(false);
    }
  }, [address, isConnected]);

  const loadConversations = useCallback(async (
    mode: "replace" | "append" = "replace"
  ) => {
    if (!address || !isConnected) return;
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    const cursor = mode === "append" ? nextCursorRef.current : null;
    if (mode === "append" && !cursor) return;
    if (mode === "append") setLoadingMore(true);
    else setListLoading(true);
    setListError(null);

    try {
      const bearer = await getSessionBearer();
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/chat/conversations?${params.toString()}`, {
        headers: { Authorization: bearer },
      });
      const data = (await res.json().catch(() => null)) as
        | ConversationsResponse
        | null;
      if (!res.ok || !data) {
        throw new Error(data?.error ?? "Failed to load conversations");
      }
      if (listRequestRef.current !== requestId) return;
      setConversations((current) =>
        mode === "append"
          ? dedupeConversations([...current, ...(data.conversations ?? [])])
          : data.conversations ?? []
      );
      const next = data.nextCursor ?? null;
      nextCursorRef.current = next;
      setNextCursor(next);
    } catch (err) {
      if (listRequestRef.current === requestId) {
        setListError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (listRequestRef.current === requestId) {
        setListLoading(false);
        setLoadingMore(false);
      }
    }
  }, [address, getSessionBearer, isConnected]);

  useEffect(() => {
    queueMicrotask(() => {
      setConversations([]);
      setNextCursor(null);
      nextCursorRef.current = null;
      setSelectedConversation(null);
      setListError(null);
      setDetailError(null);
      listRequestRef.current += 1;
      if (isConnected && address) {
        void loadConversations("replace");
        void loadAvailableAgents();
      }
    });
  }, [address, isConnected, loadAvailableAgents, loadConversations]);

  useEffect(() => {
    if (!nextCursor || listLoading || loadingMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadConversations("append");
        }
      },
      { rootMargin: "280px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [listLoading, loadConversations, loadingMore, nextCursor]);

  const loadSelectedConversation = useCallback(async () => {
    if (!selectedConversationId || !address || !isConnected) {
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    try {
      const bearer = await getSessionBearer();
      const res = await fetch(
        `/api/chat/conversations/${selectedConversationId}`,
        { headers: { Authorization: bearer } }
      );
      const data = (await res.json().catch(() => null)) as
        | ConversationResponse
        | null;
      if (!res.ok || !data?.conversation) {
        throw new Error(data?.error ?? "Failed to load conversation");
      }
      setSelectedConversation(data.conversation);
      setDraftAgent(null);
      if (data.conversation.providerAddress) {
        const provider = COMPUTE_PROVIDERS.find(
          (item) =>
            item.address.toLowerCase() ===
            data.conversation!.providerAddress!.toLowerCase()
        );
        if (provider) setSelectedProvider(provider);
      }
    } catch (err) {
      setSelectedConversation(null);
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }, [address, getSessionBearer, isConnected, selectedConversationId]);

  const handleSelectAgent = useCallback((agent: AvailableAgent) => {
    setDraftAgent({
      tokenId: agent.tokenId,
      name: agent.name ?? `Agent #${agent.tokenId}`,
      image: agent.image,
      description: agent.description,
    });
    setSelectedConversation(null);
    setDetailError(null);
    setChatError(null);
    router.push("/chat");
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation?.messages.length, chatSending]);

  useEffect(() => {
    queueMicrotask(() => {
      setChatInput("");
      setChatError(null);
    });
  }, [selectedConversationId]);

  const sendMessage = useCallback(async () => {
    const targetAgent = selectedConversation
      ? {
          tokenId: selectedConversation.tokenId,
          name: selectedConversation.agent.name,
          image: selectedConversation.agent.image,
          description: selectedConversation.agent.description,
        }
      : draftAgent;
    if (!targetAgent || !chatInput.trim() || chatSending) return;
    const query = chatInput.trim();
    setChatInput("");
    setChatSending(true);
    setChatError(null);

    const currentMessages = selectedConversation?.messages ?? [];
    const baseMessages = currentMessages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const outboundMessages = [...baseMessages, { role: "user" as const, content: query }];
    const now = new Date().toISOString();

    setSelectedConversation((current) =>
      current && selectedConversation && current.id === selectedConversation.id
        ? {
            ...current,
            messages: [
              ...current.messages,
              {
                id: `local-user-${Date.now()}`,
                sequence: current.messages.length + 1,
                role: "user",
                content: query,
                createdAt: now,
              },
            ],
          }
        : current
    );

    try {
      if (!walletClient) throw new Error("Wallet not connected");
      const provider = new BrowserProvider(walletClient.transport);
      const signer = await provider.getSigner();
      const bearer = await buildTokenBearer(targetAgent.tokenId, signer);
      const broker =
        computeWalletMode === "user" ? await getBroker() : null;
      const servingHeaders =
        computeWalletMode === "user"
          ? await broker!.inference.getRequestHeaders(selectedProvider.address)
          : null;
      const res = await fetch(`/api/token/${targetAgent.tokenId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearer,
        },
        body: JSON.stringify({
          conversationId: selectedConversation?.id ?? null,
          walletMode: computeWalletMode,
          providerAddress: selectedProvider.address,
          servingHeaders,
          messages: outboundMessages,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            content?: string;
            chatID?: string | null;
            usage?: unknown;
            conversation?: ConversationSummary;
            error?: string;
          }
        | null;
      if (!res.ok || !data) {
        throw new Error(data?.error ?? "Failed to send message");
      }
      if (computeWalletMode === "user" && data.chatID && broker) {
        await broker.inference.processResponse(
          selectedProvider.address,
          data.chatID,
          data.usage ? JSON.stringify(data.usage) : undefined
        );
      }
      const assistantContent = data.content ?? "";
      setSelectedConversation((current) => {
        const existingMessages =
          selectedConversation && current?.id === selectedConversation.id
            ? current.messages.filter(
                (message) => !message.id.startsWith("local-user-")
              )
            : currentMessages;
        const conversationId = data.conversation?.id ?? selectedConversation?.id ?? "draft";
        return {
          id: conversationId,
          tokenId: targetAgent.tokenId,
          title: data.conversation?.title ?? query,
          providerAddress: selectedProvider.address,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
          agent: {
            name: targetAgent.name,
            image: targetAgent.image,
            description: targetAgent.description,
          },
          messageCount: existingMessages.length + 2,
          preview: assistantContent,
          previewRole: "assistant",
          messages: [
            ...existingMessages,
            {
              id: `confirmed-user-${Date.now()}`,
              sequence: existingMessages.length + 1,
              role: "user",
              content: query,
              createdAt: now,
            },
            {
              id: `local-assistant-${Date.now()}`,
              sequence: existingMessages.length + 2,
              role: "assistant",
              content: assistantContent,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      });
      if (!selectedConversation?.id && data.conversation?.id) {
        router.push(`/chat/${data.conversation.id}`);
      }
      setDraftAgent(null);
      void loadConversations("replace");
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
      setSelectedConversation((current) =>
        selectedConversation && current?.id === selectedConversation.id
          ? {
              ...current,
              messages: current.messages.filter(
                (message) => !message.id.startsWith("local-user-")
              ),
            }
          : current
      );
    } finally {
      setChatSending(false);
    }
  }, [
    chatInput,
    chatSending,
    computeWalletMode,
    draftAgent,
    getBroker,
    loadConversations,
    router,
    selectedConversation,
    selectedProvider,
    walletClient,
  ]);

  useEffect(() => {
    let ignore = false;
    if (!selectedConversationId || !address || !isConnected) {
      queueMicrotask(() => {
        setSelectedConversation(null);
        setDetailError(null);
      });
      return;
    }

    queueMicrotask(async () => {
      if (ignore) return;
      await loadSelectedConversation();
    });

    return () => {
      ignore = true;
    };
  }, [address, isConnected, loadSelectedConversation, selectedConversationId]);

  const selectedTitle = useMemo(() => {
    if (selectedConversation?.title) return selectedConversation.title;
    return draftAgent?.name ?? selectedConversation?.agent.name ?? "Conversation";
  }, [draftAgent, selectedConversation]);

  const activeAgent: ChatAgent | null = selectedConversation
    ? {
        tokenId: selectedConversation.tokenId,
        name: selectedConversation.agent.name,
        image: selectedConversation.agent.image,
        description: selectedConversation.agent.description,
      }
    : draftAgent;
  const activeMessages = selectedConversation?.messages ?? [];

  if (!isConnected) {
    return (
      <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-xl">
        <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl p-xl min-h-[420px] flex flex-col items-center justify-center gap-md text-center">
          <span className="material-symbols-outlined text-outline" style={{ fontSize: 44 }}>
            chat
          </span>
          <div className="flex flex-col gap-xs">
            <h1 className="font-h1 text-h1 font-bold text-on-surface">Chat</h1>
            <p className="font-body-sub text-body-sub text-on-surface-variant">
              Connect your wallet to load your cloud conversation history.
            </p>
          </div>
          <ConnectButton />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-xl">
      <div className="flex flex-col gap-lg">
        <div className="flex items-end justify-between gap-md flex-wrap">
          <div>
            <h1 className="font-h1 text-h1 font-bold text-on-surface">Chat</h1>
            <p className="font-body-sub text-body-sub text-on-surface-variant mt-xs">
              Review your agent conversations and reopen the agent when you want to continue.
            </p>
          </div>
          <div className="flex items-center gap-sm">
            <button
              type="button"
              onClick={() => {
                setDraftAgent(null);
                setSelectedConversation(null);
                setDetailError(null);
                setChatError(null);
                setChatInput("");
                router.push("/chat");
              }}
              className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold rounded-full px-md py-sm hover:opacity-90 transition-opacity flex items-center gap-xs"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                add_comment
              </span>
              New
            </button>
            <button
              type="button"
              onClick={() => void loadConversations("replace")}
              disabled={listLoading}
              title="Refresh conversations"
              aria-label="Refresh conversations"
              className="w-10 h-10 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50 flex items-center justify-center transition-colors"
            >
              <span className={`material-symbols-outlined ${listLoading ? "animate-spin" : ""}`} style={{ fontSize: 20 }}>
                refresh
              </span>
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-lg items-start">
          <aside className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden">
            <div className="px-lg py-md border-b border-outline-variant/30 flex items-center justify-between">
              <span className="font-label-caps text-label-caps font-semibold text-on-surface">
                Conversations
              </span>
              <span className="font-data-mono text-data-mono text-outline">
                {conversations.length}
              </span>
            </div>

            <div className="max-h-[680px] overflow-y-auto">
              {listLoading && conversations.length === 0 ? (
                <div className="p-md flex flex-col gap-sm">
                  {[0, 1, 2, 3, 4].map((item) => (
                    <div key={item} className="h-20 rounded-lg bg-surface-container animate-pulse" />
                  ))}
                </div>
              ) : listError && conversations.length === 0 ? (
                <div className="p-lg flex flex-col gap-sm text-sm text-error">
                  <span>{listError}</span>
                  <button
                    type="button"
                    onClick={() => void loadConversations("replace")}
                    className="self-start text-xs underline underline-offset-2"
                  >
                    Retry
                  </button>
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-lg text-sm text-outline">
                  No conversations yet.
                </div>
              ) : (
                <div className="p-sm flex flex-col gap-xs">
                  {conversations.map((conversation) => {
                    const selected = conversation.id === selectedConversationId;
                    return (
                      <Link
                        key={conversation.id}
                        href={`/chat/${conversation.id}`}
                        className={`rounded-lg border p-sm flex gap-sm transition-colors ${
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:border-outline-variant hover:bg-surface-container"
                        }`}
                      >
                        <div className="w-12 h-12 rounded-lg bg-surface-container-high overflow-hidden shrink-0">
                          {conversation.agent.image ? (
                            <Image
                              src={conversation.agent.image}
                              alt={conversation.agent.name}
                              width={48}
                              height={48}
                              unoptimized
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-outline">
                              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                                smart_toy
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-sm">
                            <span className="text-sm font-semibold text-on-surface truncate">
                              {conversation.agent.name}
                            </span>
                            <span className="text-[11px] text-outline shrink-0">
                              {formatTime(conversation.lastMessageAt)}
                            </span>
                          </div>
                          <div className="text-xs text-on-surface-variant truncate mt-0.5">
                            {conversation.title || "Conversation"}
                          </div>
                          <div className="text-xs text-outline truncate mt-xs">
                            {conversation.preview || "No messages yet"}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                  <div ref={sentinelRef} className="h-8 flex items-center justify-center text-xs text-outline">
                    {loadingMore ? "Loading more..." : nextCursor ? "" : "End of history"}
                  </div>
                </div>
              )}
            </div>
          </aside>

          <section className="min-w-0">
            {selectedConversationId && detailLoading ? (
              <ConversationSkeleton />
            ) : selectedConversationId && detailError ? (
              <div className="h-full min-h-[420px] bg-surface-container-lowest border border-red-200 rounded-xl p-xl flex flex-col gap-sm justify-center items-center text-center">
                <span className="material-symbols-outlined text-error" style={{ fontSize: 40 }}>
                  error
                </span>
                <p className="text-error font-body-main text-body-main break-all">
                  {detailError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadSelectedConversation()}
                  className="text-sm text-error underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : !activeAgent ? (
              <EmptyWindow
                agents={availableAgents}
                loading={agentsLoading}
                error={agentsError}
                onRefresh={() => void loadAvailableAgents()}
                onSelectAgent={handleSelectAgent}
              />
            ) : activeAgent ? (
              <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl overflow-hidden flex flex-col min-h-[620px]">
                <div className="px-lg py-md border-b border-outline-variant/30 flex items-center justify-between gap-md flex-wrap">
                  <div className="flex items-center gap-md min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-surface-container-high overflow-hidden shrink-0">
                      {activeAgent.image ? (
                        <Image
                          src={activeAgent.image}
                          alt={activeAgent.name}
                          width={48}
                          height={48}
                          unoptimized
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-outline">
                          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                            smart_toy
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-h2 text-h2 font-semibold text-on-surface truncate">
                        {activeAgent.name}
                      </h2>
                      <p className="text-xs text-outline truncate">
                        {selectedConversation
                          ? `${selectedTitle} · ${formatTime(selectedConversation.lastMessageAt)}`
                          : "New conversation"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-sm flex-wrap justify-end">
                    <select
                      value={selectedProvider.address}
                      onChange={(event) => {
                        setSelectedProvider(
                          COMPUTE_PROVIDERS.find((provider) => provider.address === event.target.value) ??
                            COMPUTE_PROVIDERS[0]
                        );
                      }}
                      className="bg-surface-container border border-outline-variant rounded-lg px-sm py-xs text-sm text-on-surface focus:outline-none focus:border-primary"
                    >
                      {COMPUTE_PROVIDERS.map((provider) => (
                        <option key={provider.address} value={provider.address}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-sm cursor-pointer select-none shrink-0 border border-outline-variant rounded-lg px-sm py-xs bg-surface-container">
                      <span className={`text-xs font-semibold ${computeWalletMode === "hosted" ? "text-on-surface" : "text-outline"}`}>
                        Platform
                      </span>
                      <input
                        type="checkbox"
                        checked={computeWalletMode === "user"}
                        onChange={(event) => {
                          setComputeWalletMode(event.target.checked ? "user" : "hosted");
                          setChatError(null);
                        }}
                        className="sr-only"
                      />
                      <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${computeWalletMode === "user" ? "bg-primary" : "bg-outline-variant"}`}>
                        <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${computeWalletMode === "user" ? "translate-x-4" : "translate-x-0"}`} />
                      </span>
                      <span className={`text-xs font-semibold ${computeWalletMode === "user" ? "text-on-surface" : "text-outline"}`}>
                        Mine
                      </span>
                    </label>
                    <Link
                      href={`/agents/${activeAgent.tokenId}`}
                      className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold rounded-full px-md py-sm hover:opacity-90 transition-opacity shrink-0"
                    >
                      Open agent
                    </Link>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-lg py-md flex flex-col gap-md max-h-[620px]">
                  {activeMessages.length === 0 && !chatSending && (
                    <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center gap-sm text-outline text-center">
                      <span className="material-symbols-outlined" style={{ fontSize: 40 }}>
                        chat
                      </span>
                      <p className="font-body-sub text-body-sub">
                        Start a new conversation with <strong className="text-on-surface-variant">{activeAgent.name}</strong>
                      </p>
                    </div>
                  )}
                  {activeMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[82%] rounded-2xl px-md py-sm font-body-main text-body-main leading-relaxed whitespace-pre-wrap ${
                          message.role === "user"
                            ? "bg-primary text-on-primary rounded-br-sm"
                            : "bg-surface-container text-on-surface rounded-bl-sm"
                        }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  ))}
                  {chatSending && (
                    <div className="flex justify-start">
                      <div className="bg-surface-container rounded-2xl rounded-bl-sm px-md py-sm flex items-center gap-xs">
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="w-2 h-2 bg-outline rounded-full animate-bounce"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {chatError && (
                  <div className="mx-lg mb-sm rounded-lg border border-red-200 bg-red-50 px-md py-sm">
                    <p className="font-body-sub text-body-sub text-red-700 break-all">
                      {chatError}
                    </p>
                    <Link
                      href={`/agents/${activeAgent.tokenId}`}
                      className="text-xs text-red-500 underline underline-offset-2 mt-xs inline-block"
                    >
                      Open agent settings
                    </Link>
                  </div>
                )}

                <div className="border-t border-outline-variant/30 px-lg py-md flex gap-sm items-end">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder="Type a message... (Enter to send)"
                    rows={1}
                    disabled={chatSending}
                    className="flex-1 bg-surface-container rounded-xl px-md py-sm font-body-main text-body-main text-on-surface placeholder:text-outline resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 border border-outline-variant disabled:opacity-50 max-h-32 overflow-y-auto"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={chatSending || !chatInput.trim()}
                    title="Send message"
                    aria-label="Send message"
                    className="bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
                  >
                    {chatSending ? (
                      <span className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                    ) : (
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        send
                      </span>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              null
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
