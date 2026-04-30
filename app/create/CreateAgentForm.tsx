"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useWalletClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { uploadMetadata, uploadAgentData, uploadImage } from "@/lib/0g-storage";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? "https://opendock.vercel.app";

// ---- Step definitions ----
type Step =
  | { id: "idle" }
  | { id: "uploading_image" }
  | { id: "uploading_metadata" }
  | { id: "uploading_data" }
  | { id: "minting" }
  | { id: "waiting"; txHash: `0x${string}` }
  | { id: "done"; tokenId: bigint; txHash: `0x${string}` }
  | { id: "error"; message: string };

const STEPS = [
  { key: "uploading_image", label: "Upload Image" },
  { key: "uploading_metadata", label: "Upload Metadata" },
  { key: "uploading_data", label: "Upload Intelligence" },
  { key: "minting", label: "Mint iNFT" },
  { key: "waiting", label: "Confirming" },
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

export default function CreateAgentForm() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [agentName, setAgentName] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [kbFile, setKbFile] = useState<File | null>(null);
  const [isKbDragging, setIsKbDragging] = useState(false);
  const [isImgDragging, setIsImgDragging] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const kbInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>({ id: "idle" });

  const { writeContractAsync } = useWriteContract();

  const txHash =
    step.id === "waiting" || step.id === "done" ? step.txHash : undefined;
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (!receipt || step.id !== "waiting") return;
    for (const log of receipt.logs) {
      try {
        if (!log.topics[1]) continue;
        const tokenId = BigInt(log.topics[1]);
        setStep({ id: "done", tokenId, txHash: step.txHash });
        return;
      } catch {
        /* skip */
      }
    }
    setStep({
      id: "error",
      message: "Transaction confirmed but Minted event not found in logs.",
    });
  }, [receipt, step.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleKbChange(e: React.ChangeEvent<HTMLInputElement>) {
    setKbFile(e.target.files?.[0] ?? null);
  }

  function handleKbDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsKbDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) setKbFile(file);
  }

  const handleDeploy = useCallback(async () => {
    if (!agentName.trim()) return;
    if (!isConnected || !walletClient || !address) return;

    try {
      const provider = new BrowserProvider(walletClient.transport);
      const signer = new JsonRpcSigner(provider, address);

      // ---- Step 1: Upload image to 0G ----
      let imageHashHex = "";
      let imageMimeType = "image/png";
      if (imageFile) {
        setStep({ id: "uploading_image" });
        const { rootHash, contentType, txHash: imgTx } = await uploadImage(
          imageFile,
          signer
        );
        imageHashHex = rootHash;
        imageMimeType = contentType;
        console.log("Image upload tx:", imgTx, "hash:", rootHash);
      } else {
        // Skip image step if no image provided
        setStep({ id: "uploading_metadata" });
      }

      // ---- Step 2: Upload ERC-721 metadata ----
      if (imageFile) setStep({ id: "uploading_metadata" });

      // We use /api/image/<hash>?type=<mime> as the image URL (content-addressable)
      const imageUrl = imageHashHex
        ? `${BASE_URL}/api/image/${imageHashHex}?type=${encodeURIComponent(imageMimeType)}`
        : "";

      const { rootHash: metadataHash, txHash: metaTx } = await uploadMetadata(
        {
          name: agentName,
          description,
          image: imageUrl,
          imageHash: imageHashHex,
          systemPrompt,
        },
        signer
      );
      console.log("Metadata upload tx:", metaTx, "hash:", metadataHash);

      // ---- Step 3: Upload intelligence data ----
      setStep({ id: "uploading_data" });
      let kbBytes: Uint8Array | undefined;
      if (kbFile) {
        const buf = await kbFile.arrayBuffer();
        kbBytes = new Uint8Array(buf);
      }
      const { rootHash: dataHash, txHash: dataTx } = await uploadAgentData(
        {
          name: agentName,
          systemPrompt,
          knowledgeBase: kbBytes,
          knowledgeBaseName: kbFile?.name,
        },
        signer
      );
      console.log("Intelligence upload tx:", dataTx, "hash:", dataHash);

      // ---- Step 4: Mint iNFT ----
      setStep({ id: "minting" });
      const mintTxHash = await writeContractAsync({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "mint",
        args: [
          [{ dataDescription: agentName, dataHash }],
          metadataHash,
          address,
        ],
      });

      // ---- Step 5: Wait ----
      setStep({ id: "waiting", txHash: mintTxHash });
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
    kbFile,
    isConnected,
    walletClient,
    address,
    writeContractAsync,
  ]);

  const isRunning = [
    "uploading_image",
    "uploading_metadata",
    "uploading_data",
    "minting",
    "waiting",
  ].includes(step.id);

  return (
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
              Upload Knowledge Base{" "}
              <span className="font-normal text-outline">(optional)</span>
            </span>
            <div
              onClick={() => !isRunning && kbInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isRunning) setIsKbDragging(true);
              }}
              onDragLeave={() => setIsKbDragging(false)}
              onDrop={isRunning ? undefined : handleKbDrop}
              className={`border-2 border-dashed transition-colors rounded-xl p-xl flex flex-col items-center justify-center ${
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
                className="material-symbols-outlined text-outline group-hover:text-primary mb-md transition-colors"
                style={{ fontSize: 32 }}
              >
                upload_file
              </span>
              {kbFile ? (
                <>
                  <span className="font-body-main text-body-main text-on-surface font-semibold">
                    {kbFile.name}
                  </span>
                  <span className="font-body-sub text-body-sub text-outline mt-xs">
                    {(kbFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </>
              ) : (
                <>
                  <span className="font-body-main text-body-main text-on-surface-variant font-semibold group-hover:text-primary transition-colors">
                    Click to upload or drag and drop
                  </span>
                  <span className="font-body-sub text-body-sub text-outline mt-xs">
                    PDF, TXT, or JSON (Max 50MB)
                  </span>
                </>
              )}
              <input
                ref={kbInputRef}
                type="file"
                accept=".pdf,.txt,.json"
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
                    {step.id === "uploading_image" && "Uploading image…"}
                    {step.id === "uploading_metadata" && "Uploading metadata…"}
                    {step.id === "uploading_data" && "Uploading intelligence…"}
                    {step.id === "minting" && "Minting…"}
                    {step.id === "waiting" && "Confirming…"}
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
  );
}
