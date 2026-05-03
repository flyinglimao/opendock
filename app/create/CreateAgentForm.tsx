"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { decodeEventLog } from "viem";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";
import PreviewChatPanel from "./PreviewChatPanel";

// ---- Step definitions ----
type Step =
  | { id: "idle" }
  | { id: "uploading" }
  | { id: "minting" }
  | {
      id: "waiting";
      txHash: `0x${string}`;
      metadataHash: string;
      dataHash: string;
      owner: string;
    }
  | { id: "registering"; txHash: `0x${string}` }
  | { id: "done"; tokenId: bigint; txHash: `0x${string}` }
  | { id: "error"; message: string };

const STEPS = [
  { key: "uploading", label: "Upload to 0G" },
  { key: "minting", label: "Mint iNFT" },
  { key: "waiting", label: "Confirming" },
  { key: "registering", label: "Registering" },
  { key: "done", label: "Done" },
] as const;

function StepIndicator({ step }: { step: Step }) {
  const activeIndex = STEPS.findIndex((s) => s.key === step.id);
  return (
    <ol className="flex items-center gap-0 w-full mb-lg">
      {STEPS.map((s, i) => {
        const done = activeIndex > i;
        const active = activeIndex === i;
        return (
          <li key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-xs min-w-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  done
                    ? "bg-primary text-on-primary"
                    : active
                      ? "bg-primary/20 text-primary ring-2 ring-primary"
                      : "bg-surface-container text-outline"
                }`}
              >
                {done ? (
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    check
                  </span>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`font-body-sub text-body-sub text-center leading-tight ${active ? "text-primary font-semibold" : "text-outline"}`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-sm transition-colors ${done ? "bg-primary" : "bg-outline-variant"}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".log"];

function isTextFile(file: File): boolean {
  if (TEXT_MIME_PREFIXES.some((p) => file.type.startsWith(p))) return true;
  if (file.type === "application/json") return true;
  const name = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Resize image to max 512px on the longest side and convert to WebP via canvas. */
async function resizeToWebP(file: File, maxPx = 512, quality = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width: w, height: h } = img;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas 2D context unavailable"));
      ctx.drawImage(img, 0, 0, tw, th);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Canvas toBlob failed"));
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" }));
        },
        "image/webp",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}
// ---- localStorage helpers ----
export interface MintedToken {
  tokenId: string;  // stored as string for JSON safety
  name: string;
  txHash: string;
  mintedAt: number; // unix ms
}

const LS_KEY = "opendock_minted_tokens";

export function saveMintedToken(token: MintedToken) {
  try {
    const existing: MintedToken[] = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    // De-duplicate by tokenId
    const updated = [
      token,
      ...existing.filter((t) => t.tokenId !== token.tokenId),
    ];
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

export function loadMintedTokens(): MintedToken[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}


export default function CreateAgentForm() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const [agentName, setAgentName] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [kbFiles, setKbFiles] = useState<File[]>([]);
  const [isKbDragging, setIsKbDragging] = useState(false);
  const [isImgDragging, setIsImgDragging] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const kbInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>({ id: "idle" });

  const { writeContractAsync } = useWriteContract();

  const txHash =
    step.id === "waiting" || step.id === "registering" || step.id === "done"
      ? step.txHash
      : undefined;
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (!receipt || step.id !== "waiting") return;
    const { metadataHash, dataHash, owner } = step;
    const waitingTxHash = step.txHash;

    async function registerToken(tokenId: bigint) {
      try {
        setStep({ id: "registering", txHash: waitingTxHash });
        const res = await fetch(`/api/token/${tokenId}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadataHash,
            dataHash,
            owner,
          }),
        });

        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Failed to register minted agent.");
        }

        setStep({ id: "done", tokenId, txHash: waitingTxHash });
      } catch (err) {
        setStep({
          id: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: INFT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== "Minted") continue;
        const tokenId = decoded.args.tokenId;
        saveMintedToken({
          tokenId: tokenId.toString(),
          name: agentName,
          txHash: waitingTxHash,
          mintedAt: Date.now(),
        });
        registerToken(tokenId);
        return;
      } catch {
        /* skip */
      }
    }
    queueMicrotask(() => {
      setStep({
        id: "error",
        message: "Transaction confirmed but Minted event not found in logs.",
      });
    });
  }, [receipt, step, agentName]);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) setImagePreview(URL.createObjectURL(file));
    else setImagePreview(null);
  }

  function handleImageDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsImgDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file && file.type.startsWith("image/")) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  }

  function addKbFiles(incoming: FileList | File[]) {
    const valid: File[] = [];
    for (const f of Array.from(incoming)) {
      if (!isTextFile(f)) {
        alert(`"${f.name}" is not supported. Only plain text files (TXT, MD, CSV, JSON, etc.) are allowed.`);
        return;
      }
      valid.push(f);
    }
    setKbFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !names.has(f.name))];
    });
  }

  function handleKbChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addKbFiles(e.target.files);
    e.target.value = "";
  }

  function handleKbDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsKbDragging(false);
    if (e.dataTransfer.files?.length) addKbFiles(e.dataTransfer.files);
  }

  const handleDeploy = useCallback(async () => {
    if (!agentName.trim()) return;
    if (!isConnected || !address) return;

    try {
      // ---- Step 1: Upload all assets to 0G via server (server wallet pays fees) ----
      setStep({ id: "uploading" });

      const formData = new FormData();
      formData.set("name", agentName);
      formData.set("description", description);
      formData.set("systemPrompt", systemPrompt);
      if (imageFile) {
        const resized = await resizeToWebP(imageFile);
        formData.set("image", resized);
      }
      if (kbFiles.length > 0) {
        const kbData = await Promise.all(
          kbFiles.map(async (f) => ({ name: f.name, content: await f.text() }))
        );
        formData.set("knowledgeBaseFiles", JSON.stringify(kbData));
      }

      const uploadRes = await fetch("/api/agent/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => null) as { error?: string } | null;
        throw new Error(err?.error ?? "Upload failed");
      }
      const { metadataHash, dataHash } = await uploadRes.json() as {
        imageHash: string;
        imageMimeType: string;
        metadataHash: `0x${string}`;
        dataHash: `0x${string}`;
      };

      // ---- Step 2: Mint iNFT ----
      setStep({ id: "minting" });
      const mintTxHash = await writeContractAsync({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "mint",
        args: [
          [{ dataDescription: "agent-intelligence", dataHash }],
          metadataHash,
          address,
        ],
      });

      // ---- Step 3: Wait for confirmation ----
      setStep({
        id: "waiting",
        txHash: mintTxHash,
        metadataHash,
        dataHash,
        owner: address,
      });
    } catch (err) {
      setStep({
        id: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    agentName,
    description,
    imageFile,
    systemPrompt,
    kbFiles,
    isConnected,
    address,
    writeContractAsync,
  ]);

  const isRunning = [
    "uploading",
    "minting",
    "waiting",
    "registering",
  ].includes(step.id);

  return (
    <div className="flex flex-col lg:flex-row items-start gap-gutter w-full">
      {/* ---- Left column: form card ---- */}
      <div className="flex-1 min-w-0">
        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-shadow duration-300 w-full p-lg md:p-10 flex flex-col">
          <header className="mb-xl text-center">
            <h1 className="font-h1 text-h1 font-bold text-on-surface mb-sm">
              Deploy New Agent
            </h1>
            <p className="font-body-sub text-body-sub text-on-surface-variant">
              Configure the parameters and knowledge base for your decentralized AI agent.
            </p>
          </header>
          <form
            className="flex flex-col gap-gutter"
            onSubmit={(e) => {
              e.preventDefault();
              handleDeploy();
            }}
          >
      {/* Step indicator */}
      {step.id !== "idle" && step.id !== "error" && (
        <StepIndicator step={step} />
      )}

      {/* Success */}
      {step.id === "done" && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-md flex flex-col gap-sm">
          <div className="flex items-center gap-sm text-green-700">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20 }}
            >
              check_circle
            </span>
            <span className="font-semibold">Agent deployed successfully!</span>
          </div>
          <p className="font-body-sub text-body-sub text-green-600">
            Token ID:{" "}
            <span className="font-mono font-bold">
              {step.tokenId.toString()}
            </span>
          </p>
          <a
            href={`https://chainscan-galileo.0g.ai/tx/${step.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-body-sub text-body-sub text-primary underline"
          >
            View on explorer ↗
          </a>
          <button
            type="button"
            onClick={() => router.push(`/agents/${step.tokenId}`)}
            className="mt-sm self-start bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-sm px-lg rounded-full"
          >
            View Agent
          </button>
        </div>
      )}

      {/* Error */}
      {step.id === "error" && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-md">
          <div className="flex items-center gap-sm text-red-700 mb-xs">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20 }}
            >
              error
            </span>
            <span className="font-semibold">Deployment failed</span>
          </div>
          <p className="font-body-sub text-body-sub text-red-600 break-all">
            {step.message}
          </p>
          <button
            type="button"
            onClick={() => setStep({ id: "idle" })}
            className="mt-sm text-sm text-red-600 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Form */}
      {step.id !== "done" && (
        <>
          {/* Agent Name */}
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="agent-name"
              className="font-label-caps text-label-caps font-semibold text-on-surface"
            >
              Agent Name *
            </label>
            <input
              id="agent-name"
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              disabled={isRunning}
              placeholder="e.g. DeFi Sentiment Analyzer"
              required
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md font-body-main text-body-main text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all w-full disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="description"
              className="font-label-caps text-label-caps font-semibold text-on-surface"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isRunning}
              placeholder="What does this agent do? Who is it for?"
              rows={3}
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md font-body-main text-body-main text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all w-full resize-none disabled:opacity-50"
            />
          </div>

          {/* Avatar Image Upload */}
          <div className="flex flex-col gap-sm">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">
              Avatar Image{" "}
              <span className="font-normal text-outline">(optional)</span>
            </span>
            <div className="flex gap-md items-start">
              {/* Preview */}
              {imagePreview ? (
                <div className="relative flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="preview"
                    className="w-20 h-20 rounded-xl object-cover border border-outline-variant"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImageFile(null);
                      setImagePreview(null);
                    }}
                    disabled={isRunning}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-error text-white rounded-full text-xs flex items-center justify-center hover:opacity-80 disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
              ) : null}

              {/* Drop zone */}
              <div
                onClick={() => !isRunning && imageInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isRunning) setIsImgDragging(true);
                }}
                onDragLeave={() => setIsImgDragging(false)}
                onDrop={isRunning ? undefined : handleImageDrop}
                className={`flex-1 border-2 border-dashed rounded-xl p-lg flex flex-col items-center justify-center transition-colors min-h-[80px] ${
                  isRunning
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer group"
                } ${
                  isImgDragging
                    ? "border-primary/50 bg-surface-container"
                    : "border-outline-variant hover:border-primary/50 bg-surface-container-low"
                }`}
              >
                <span
                  className="material-symbols-outlined text-outline group-hover:text-primary transition-colors"
                  style={{ fontSize: 28 }}
                >
                  add_photo_alternate
                </span>
                <span className="font-body-sub text-body-sub text-on-surface-variant group-hover:text-primary transition-colors text-center mt-xs">
                  {imageFile
                    ? imageFile.name
                    : "Click or drag to upload image"}
                </span>
                {imageFile && (
                  <span className="font-body-sub text-body-sub text-outline mt-xs">
                    {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>
            </div>
            <p className="font-body-sub text-body-sub text-outline text-xs">
              Will be uploaded to 0G Storage — PNG, JPG, GIF, WebP supported.
            </p>
          </div>

          {/* System Prompt */}
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="system-prompt"
              className="font-label-caps text-label-caps font-semibold text-on-surface"
            >
              System Prompt
            </label>
            <textarea
              id="system-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={isRunning}
              placeholder="Define the agent's persona, rules, and primary objectives..."
              rows={5}
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md font-body-main text-body-main text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all w-full resize-none disabled:opacity-50"
            />
          </div>

          {/* Knowledge Base */}
          <div className="flex flex-col gap-sm">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">
              Knowledge Base Files{" "}
              <span className="font-normal text-outline">(optional)</span>
            </span>

            {/* Uploaded file list */}
            {kbFiles.length > 0 && (
              <ul className="flex flex-col gap-xs">
                {kbFiles.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-center justify-between gap-sm bg-surface-container rounded-lg px-md py-sm"
                  >
                    <div className="flex items-center gap-sm min-w-0">
                      <span className="material-symbols-outlined text-outline" style={{ fontSize: 18 }}>
                        description
                      </span>
                      <span className="font-body-sub text-body-sub text-on-surface truncate">{f.name}</span>
                      <span className="font-body-sub text-body-sub text-outline shrink-0">
                        {(f.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => setKbFiles((prev) => prev.filter((x) => x.name !== f.name))}
                      className="text-outline hover:text-error transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Drop zone */}
            <div
              onClick={() => !isRunning && kbInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isRunning) setIsKbDragging(true);
              }}
              onDragLeave={() => setIsKbDragging(false)}
              onDrop={isRunning ? undefined : handleKbDrop}
              className={`border-2 border-dashed transition-colors rounded-xl p-lg flex flex-col items-center justify-center ${
                isRunning
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer group"
              } ${
                isKbDragging
                  ? "border-primary/50 bg-surface-container"
                  : "border-outline-variant hover:border-primary/50 bg-surface-container-low"
              }`}
            >
              <span
                className="material-symbols-outlined text-outline group-hover:text-primary mb-xs transition-colors"
                style={{ fontSize: 28 }}
              >
                upload_file
              </span>
              <span className="font-body-sub text-body-sub text-on-surface-variant group-hover:text-primary transition-colors text-center">
                {kbFiles.length > 0 ? "Add more files" : "Click to upload or drag and drop"}
              </span>
              <span className="font-body-sub text-body-sub text-outline mt-xs text-center">
                TXT, MD, CSV, JSON, YAML… any plain text
              </span>
              <input
                ref={kbInputRef}
                type="file"
                multiple
                accept=".txt,.md,.csv,.json,.yaml,.yml,.toml,.xml,.log,text/*"
                onChange={handleKbChange}
                className="hidden"
              />
            </div>
          </div>

          {/* CTA */}
          <div className="mt-lg pt-lg border-t border-surface-variant flex justify-end">
            {!isConnected ? (
              <ConnectButton />
            ) : (
              <button
                type="submit"
                disabled={isRunning || !agentName.trim()}
                className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-md px-xl rounded-full hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] active:scale-95 transition-all flex items-center justify-center gap-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {isRunning ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                    {step.id === "uploading" && "Uploading to 0G…"}
                    {step.id === "minting" && "Minting…"}
                    {step.id === "waiting" && "Confirming…"}
                    {step.id === "registering" && "Registering…"}
                  </>
                ) : (
                  <>
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 18 }}
                    >
                      rocket_launch
                    </span>
                    Deploy to 0G
                  </>
                )}
              </button>
            )}
          </div>
        </>
      )}
          </form>
        </div>
      </div>

      {/* ---- Right column: sticky chat panel ---- */}
      <div className="w-full lg:w-[480px] lg:flex-shrink-0 lg:sticky lg:top-6 self-start">
        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.05)] flex flex-col gap-sm overflow-hidden">
          <div className="flex items-center justify-between px-lg pt-lg">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">
              Test Agent
            </span>
            <span className="font-body-sub text-body-sub text-outline text-xs">
              Preview before deploying
            </span>
          </div>
          <PreviewChatPanel systemPrompt={systemPrompt} kbFiles={kbFiles} />
        </div>
      </div>
    </div>
  );
}
