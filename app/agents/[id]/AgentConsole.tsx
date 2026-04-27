"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  role: "agent" | "user" | "system";
  content: string;
  isCode?: boolean;
  codeContent?: string;
}

const initialMessages: Message[] = [
  {
    id: "sys-1",
    role: "system",
    content: "SESSION STARTED - SECURE CONNECTION ESTABLISHED",
  },
  {
    id: "agent-1",
    role: "agent",
    content:
      "Nexus initialized. Ready to accept query parameters for chain ID 1 or 137. Awaiting instruction.",
  },
  {
    id: "user-1",
    role: "user",
    content:
      "Fetch top 5 liquidity pools by volume on Uniswap V3 over the last 24h.",
  },
  {
    id: "agent-2",
    role: "agent",
    content: "Querying indexer...",
    isCode: true,
    codeContent: `[\n  { "pool": "WETH/USDC", "vol": "420.5M", "fee": "0.05%" },\n  { "pool": "WBTC/WETH", "vol": "180.2M", "fee": "0.30%" },\n  { "pool": "USDT/USDC", "vol": "95.1M", "fee": "0.01%" }\n]`,
  },
];

export default function AgentConsole() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const agentReply: Message = {
      id: `agent-${Date.now()}`,
      role: "agent",
      content: "Processing your query. Please wait...",
    };

    setMessages((prev) => [...prev, userMsg, agentReply]);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSend();
  }

  return (
    <div className="flex-1 flex flex-col min-h-[500px] bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-[0px_4px_20px_rgba(0,0,0,0.05)]">
      {/* Terminal Header */}
      <div className="bg-surface-container-high px-md py-sm border-b border-outline-variant flex items-center justify-between">
        <div className="flex items-center gap-2 text-on-surface">
          <span className="material-symbols-outlined text-[18px]">
            terminal
          </span>
          <span className="font-body-sub text-body-sub font-semibold">
            Interaction Console
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMessages(initialMessages)}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
            title="Reset session"
          >
            <span className="material-symbols-outlined text-[18px]">
              restart_alt
            </span>
          </button>
          <button
            className="text-on-surface-variant hover:text-on-surface transition-colors"
            title="Settings"
          >
            <span className="material-symbols-outlined text-[18px]">
              settings
            </span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 p-md overflow-y-auto bg-surface flex flex-col gap-md"
      >
        {messages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div
                key={msg.id}
                className="flex flex-col items-center mb-sm"
              >
                <span className="font-label-caps text-label-caps font-semibold text-outline">
                  {msg.content}
                </span>
              </div>
            );
          }

          if (msg.role === "user") {
            return (
              <div
                key={msg.id}
                className="flex gap-3 max-w-[85%] self-end flex-row-reverse"
              >
                <div className="w-8 h-8 rounded-full bg-surface-variant text-on-surface flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[16px]">
                    person
                  </span>
                </div>
                <div className="bg-primary-container text-on-primary rounded-lg rounded-tr-none p-3 shadow-sm font-body-sub text-body-sub">
                  {msg.content}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex gap-3 max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-secondary text-on-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[16px]">
                  smart_toy
                </span>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant rounded-lg rounded-tl-none p-3 shadow-sm font-body-sub text-body-sub text-on-surface w-full">
                {msg.isCode ? (
                  <>
                    <div className="flex items-center gap-2 text-outline mb-2">
                      <span className="material-symbols-outlined text-[14px] animate-spin">
                        sync
                      </span>
                      <span className="font-data-mono text-[11px]">
                        {msg.content}
                      </span>
                    </div>
                    <pre className="font-data-mono text-data-mono bg-surface-variant p-2 rounded text-on-surface-variant overflow-x-auto">
                      {msg.codeContent}
                    </pre>
                  </>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="bg-surface-container-lowest border-t border-outline-variant p-sm flex items-center gap-2">
        <button className="text-outline hover:text-on-surface p-2 transition-colors">
          <span className="material-symbols-outlined text-[20px]">
            attach_file
          </span>
        </button>
        <div className="flex-1 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a command or query..."
            className="w-full bg-surface border border-outline-variant rounded-lg py-2 pl-3 pr-10 font-body-main text-body-main text-on-surface placeholder:text-outline focus:border-primary-container focus:ring-2 focus:ring-primary-container/10 outline-none transition-all"
          />
          <button
            onClick={handleSend}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-primary-container hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
