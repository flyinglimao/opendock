import Image from "next/image";
import Chip from "@/components/Chip";
import AgentConsole from "./AgentConsole";

export const metadata = {
  title: "Nexus Data Aggregator - OpenDock",
};

export default function AgentDetailPage() {
  return (
    <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-xl flex flex-col md:flex-row gap-gutter">
      {/* Left Column: Identity & Access */}
      <div className="w-full md:w-1/3 flex flex-col gap-lg">
        {/* Agent Image */}
        <div className="rounded-xl overflow-hidden shadow-[0px_4px_20px_rgba(0,0,0,0.05)] bg-surface-container-lowest aspect-square border border-outline-variant/30 relative">
          <Image
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuACimozlzb_LwsclV5fbrpiAyK1-hoiv9Gjd0qyPnmBt8DMDBz8PwQ8wpJSODcVx9681PGKOefEDF3QfGs74GYRBiaAIjNzI5_ujlbOaXozssMU9lOdnEtejxH7FMEdfCu3pr8RWaJ9q7ZlQsFZQOGjZ3C6F4v2-oCsqY3gwjyrDFIFmvjYnO0UGnb09LG-KZ8ksIXOLm1MKxfP7OkHIeC8rsLvIll077YcXfRIdUSP4Y2d3wd7DKKHThdi2xZFQmJ7xoZ95NVAx_cI"
            alt="Abstract minimalist 3d render of a glowing blue crystal structure"
            fill
            className="object-cover"
            unoptimized
          />
        </div>

        {/* Pricing Card */}
        <div className="bg-surface-container-lowest rounded-xl p-lg shadow-[0px_4px_20px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <span className="font-body-sub text-body-sub text-on-surface-variant">
              Current Access Price
            </span>
            <div className="font-h1 text-h1 font-bold text-on-surface">
              250 USDC
            </div>
          </div>

          <div className="flex flex-col gap-xs">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">
              Contract Address
            </span>
            <div className="bg-surface-container p-sm rounded border border-outline-variant flex items-center justify-between group cursor-pointer hover:bg-surface-variant transition-colors">
              <span className="font-data-mono text-data-mono text-on-surface truncate pr-2">
                0x71C...976F
              </span>
              <span className="material-symbols-outlined text-on-surface-variant text-[16px] group-hover:text-primary">
                content_copy
              </span>
            </div>
          </div>

          <button className="w-full bg-primary-container text-on-primary py-md rounded-lg font-body-main text-body-main font-semibold mt-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm">
            <span className="material-symbols-outlined text-[20px]">
              shopping_cart
            </span>
            Buy Agent Access
          </button>
        </div>

        {/* Performance Card */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.05)] border border-outline-variant/30 flex flex-col gap-sm">
          <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">
            Agent Performance
          </span>
          <div className="flex justify-between items-center border-b border-outline-variant/50 pb-sm">
            <span className="font-body-sub text-body-sub text-on-surface">
              Uptime
            </span>
            <span className="font-body-main text-body-main font-semibold text-secondary">
              99.9%
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-outline-variant/50 pb-sm">
            <span className="font-body-sub text-body-sub text-on-surface">
              Latency
            </span>
            <span className="font-body-main text-body-main font-semibold text-on-surface">
              ~400ms
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-body-sub text-body-sub text-on-surface">
              Total Calls
            </span>
            <span className="font-body-main text-body-main font-semibold text-on-surface">
              1.2M+
            </span>
          </div>
        </div>
      </div>

      {/* Right Column: Info & Console */}
      <div className="w-full md:w-2/3 flex flex-col gap-lg">
        {/* Agent Info */}
        <div className="flex flex-col gap-sm">
          <div className="flex items-center gap-3">
            <h1 className="font-h1 text-h1 font-bold text-on-surface">
              Nexus Data Aggregator
            </h1>
            <div
              className="w-2 h-2 rounded-full bg-[#10B981] ml-2"
              title="Live"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Chip label="DATA ANALYSIS" variant="pill" />
            <Chip label="REAL-TIME" variant="pill" />
            <Chip label="ON-CHAIN" variant="pill" />
          </div>

          <p className="font-body-main text-body-main text-on-surface-variant mt-sm leading-relaxed max-w-3xl">
            Nexus is a highly specialized data aggregation agent trained to
            parse, normalize, and deliver multi-chain smart contract events in
            real-time. Designed for high-frequency trading algorithms and complex
            analytics platforms requiring pristine data hygiene.
          </p>
        </div>

        {/* Interaction Console */}
        <AgentConsole />
      </div>
    </main>
  );
}
