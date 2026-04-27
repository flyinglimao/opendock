"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function CreateAgentForm() {
  const router = useRouter();
  const [agentName, setAgentName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setUploadedFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) setUploadedFile(file);
  }

  function handleDeploy() {
    if (!agentName.trim()) return;
    router.push("/dashboard");
  }

  return (
    <form
      className="flex flex-col gap-gutter"
      onSubmit={(e) => {
        e.preventDefault();
        handleDeploy();
      }}
    >
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
          placeholder="e.g. DeFi Sentiment Analyzer"
          className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md font-body-main text-body-main text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all w-full"
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
          placeholder="Define the agent's persona, rules, and primary objectives..."
          rows={5}
          className="bg-surface-container-lowest border border-outline-variant rounded-xl p-md font-body-main text-body-main text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all w-full resize-none"
        />
      </div>

      {/* Knowledge Base Upload */}
      <div className="flex flex-col gap-sm">
        <span className="font-label-caps text-label-caps font-semibold text-on-surface">
          Upload Knowledge Base
        </span>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed transition-colors rounded-xl p-xl flex flex-col items-center justify-center cursor-pointer group ${
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
      <div className="mt-lg pt-lg border-t border-surface-variant flex justify-end">
        <button
          type="submit"
          className="bg-primary text-on-primary font-label-caps text-label-caps font-semibold py-md px-xl rounded-full hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] active:scale-95 transition-all w-full md:w-auto flex items-center justify-center gap-sm"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            rocket_launch
          </span>
          Deploy to 0G
        </button>
      </div>
    </form>
  );
}
