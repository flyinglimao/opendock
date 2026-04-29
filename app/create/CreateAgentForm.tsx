"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { uploadAgentData } from "@/lib/0g-storage";
import { INFT_ADDRESS, INFT_ABI } from "@/lib/contracts";

// ---- Step definitions ----
type Step =
  | { id: "idle" }
  | { id: "uploading" }
  | { id: "minting" }
  | { id: "waiting"; txHash: `0x${string}` }
  | { id: "done"; tokenId: bigint; txHash: `0x${string}` }
  | { id: "error"; message: string };

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { key: "uploading", label: "Upload to 0G Storage" },
    { key: "minting", label: "Mint iNFT" },
    { key: "waiting", label: "Confirming" },
    { key: "done", label: "Done" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step.id);

  return (
    <ol className="flex items-center gap-0 w-full mb-lg">
      {steps.map((s, i) => {
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
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    check
                  </span>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`font-body-sub text-body-sub text-center leading-tight ${
                  active ? "text-primary font-semibold" : "text-outline"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-sm transition-colors ${
                  done ? "bg-primary" : "bg-outline-variant"
                }`}
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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>({ id: "idle" });

  // wagmi contract write
  const { writeContractAsync } = useWriteContract();

  // Watch for tx confirmation
  const txHash = step.id === "waiting" || step.id === "done" ? step.txHash : undefined;
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  });

  // Parse tokenId from Minted event once receipt arrives
  const mintedTokenId =
    receipt?.logs
      .map((log) => {
        try {
          // Minted event: tokenId is the first indexed topic (topics[1])
          const tokenId = BigInt(log.topics[1] ?? "0");
          return tokenId;
        } catch {
          return null;
        }
      })
      .find((id) => id !== null) ?? null;

  if (mintedTokenId && step.id === "waiting") {
    setStep({ id: "done", tokenId: mintedTokenId, txHash: step.txHash });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadedFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) setUploadedFile(file);
  }

  const handleDeploy = useCallback(async () => {
    if (!agentName.trim()) return;
    if (!isConnected || !walletClient || !address) return;

    try {
      // ---- Step 1: Upload to 0G Storage ----
      setStep({ id: "uploading" });

      // Convert wagmi WalletClient → ethers Signer (required by 0G SDK)
      const provider = new BrowserProvider(walletClient.transport);
      const signer = new JsonRpcSigner(provider, address);

      let kbBytes: Uint8Array | undefined;
      if (uploadedFile) {
        const arrayBuffer = await uploadedFile.arrayBuffer();
        kbBytes = new Uint8Array(arrayBuffer);
      }

      const { rootHash, txHash: storageTx } = await uploadAgentData(
        {
          name: agentName,
          systemPrompt,
          knowledgeBase: kbBytes,
          knowledgeBaseName: uploadedFile?.name,
        },
        signer
      );

      console.log("0G Storage upload tx:", storageTx);
      console.log("dataHash (rootHash):", rootHash);

      // ---- Step 2: Mint iNFT ----
      setStep({ id: "minting" });

      const mintTxHash = await writeContractAsync({
        address: INFT_ADDRESS,
        abi: INFT_ABI,
        functionName: "mint",
        args: [
          [{ dataDescription: agentName, dataHash: rootHash as `0x${string}` }],
          address,
        ],
      });

      // ---- Step 3: Wait for confirmation ----
      setStep({ id: "waiting", txHash: mintTxHash });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStep({ id: "error", message });
    }
  }, [agentName, systemPrompt, uploadedFile, isConnected, walletClient, address, writeContractAsync]);

  const isRunning = step.id === "uploading" || step.id === "minting" || step.id === "waiting";

  return (
    <form
      className="flex flex-col gap-gutter"
      onSubmit={(e) => {
        e.preventDefault();
        handleDeploy();
      }}
    >
      {/* Step indicator — only shown while deploying */}
      {step.id !== "idle" && step.id !== "error" && (
        <StepIndicator step={step} />
      )}

      {/* Success banner */}
      {step.id === "done" && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-md flex flex-col gap-sm">
          <div className="flex items-center gap-sm text-green-700">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              check_circle
            </span>
            <span className="font-semibold">Agent deployed successfully!</span>
          </div>
          <p className="font-body-sub text-body-sub text-green-600">
            Token ID: <span className="font-mono font-bold">{step.tokenId.toString()}</span>
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
            onClick={() => router.push("/dashboard")}
            className="mt-sm self-start bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-sm px-lg rounded-full"
          >
            Go to Dashboard
          </button>
        </div>
      )}

      {/* Error banner */}
      {step.id === "error" && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-md">
          <div className="flex items-center gap-sm text-red-700 mb-xs">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              error
            </span>
            <span className="font-semibold">Deployment failed</span>
          </div>
          <p className="font-body-sub text-body-sub text-red-600 break-all">{step.message}</p>
          <button
            type="button"
            onClick={() => setStep({ id: "idle" })}
            className="mt-sm text-sm text-red-600 underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Form fields — disabled while running */}
      {step.id !== "done" && (
        <>
          {/* Agent Name */}
          <div className="flex flex-col gap-sm">
            <label
              htmlFor="agent-name"
              className="font-label-caps text-label-caps font-semibold text-on-surface"
            >
              Agent Name
            </label>
            <input
              id="agent-name"
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              disabled={isRunning}
              placeholder="e.g. DeFi Sentiment Analyzer"
              className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md font-body-main text-body-main text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all w-full disabled:opacity-50"
              required
            />
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

          {/* Knowledge Base Upload */}
          <div className="flex flex-col gap-sm">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface">
              Upload Knowledge Base{" "}
              <span className="font-normal text-outline">(optional)</span>
            </span>
            <div
              onClick={() => !isRunning && fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isRunning) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={isRunning ? undefined : handleDrop}
              className={`border-2 border-dashed transition-colors rounded-xl p-xl flex flex-col items-center justify-center ${
                isRunning
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer group"
              } ${
                isDragging
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
              {uploadedFile ? (
                <>
                  <span className="font-body-main text-body-main text-on-surface font-semibold">
                    {uploadedFile.name}
                  </span>
                  <span className="font-body-sub text-body-sub text-outline mt-xs">
                    {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
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
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Deploy Button */}
          <div className="mt-lg pt-lg border-t border-surface-variant flex flex-col sm:flex-row items-center justify-between gap-md">
            {/* Wallet connect / status */}
            {!isConnected ? (
              <div className="flex flex-col gap-xs w-full sm:w-auto">
                <p className="font-body-sub text-body-sub text-outline text-center sm:text-left">
                  Connect your wallet to deploy
                </p>
                <ConnectButton />
              </div>
            ) : (
              <div className="flex items-center gap-sm">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="font-body-sub text-body-sub text-on-surface-variant font-mono">
                  {address?.slice(0, 6)}…{address?.slice(-4)}
                </span>
                <ConnectButton showBalance={false} accountStatus="address" />
              </div>
            )}

            <button
              type="submit"
              disabled={!isConnected || isRunning || !agentName.trim()}
              className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-md px-xl rounded-full hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] active:scale-95 transition-all w-full sm:w-auto flex items-center justify-center gap-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isRunning ? (
                <>
                  <span
                    className="inline-block w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin"
                  />
                  {step.id === "uploading" && "Uploading…"}
                  {step.id === "minting" && "Minting…"}
                  {step.id === "waiting" && "Confirming…"}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    rocket_launch
                  </span>
                  Deploy to 0G
                </>
              )}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
