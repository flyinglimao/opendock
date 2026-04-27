"use client";

import { useState } from "react";
import Link from "next/link";

interface TaskRow {
  id: string;
  agent: string;
  status: "success" | "pending" | "failed";
  lastRun: string;
}

const taskRows: TaskRow[] = [
  { id: "tsk_98x1", agent: "Sentinel Data Scraper", status: "success", lastRun: "2 mins ago" },
  { id: "tsk_98x0", agent: "Sentinel Data Scraper", status: "success", lastRun: "1 hr ago" },
  { id: "tsk_97z4", agent: "Yield Optimizer Alpha", status: "pending", lastRun: "12 hrs ago" },
];

function StatusIcon({ status }: { status: TaskRow["status"] }) {
  if (status === "success") {
    return (
      <span
        className="material-symbols-outlined text-[#10B981] text-sm"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        check_circle
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span
        className="material-symbols-outlined text-outline text-sm"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        pending
      </span>
    );
  }
  return (
    <span
      className="material-symbols-outlined text-error text-sm"
      style={{ fontVariationSettings: "'FILL' 1" }}
    >
      cancel
    </span>
  );
}

export default function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<"assets" | "automations">(
    "assets"
  );

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
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            grid_view
          </span>
          My Assets
        </button>
        <button
          onClick={() => setActiveTab("automations")}
          className={`pb-3 border-b-2 font-body-main text-body-main flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeTab === "automations"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-on-surface-variant hover:text-on-background"
          }`}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            auto_awesome
          </span>
          Automations
        </button>
      </div>

      {activeTab === "assets" && (
        <>
          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {/* Agent Card 1 */}
            <div className="bg-surface rounded-xl p-md border border-outline-variant shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-shadow flex flex-col justify-between h-64">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 rounded-lg bg-surface-container flex items-center justify-center border border-outline-variant">
                    <span
                      className="material-symbols-outlined text-primary text-2xl"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      smart_toy
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-surface-bright border border-outline-variant px-2 py-1 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-[#10B981]" />
                    <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">
                      Live
                    </span>
                  </div>
                </div>
                <div>
                  <h2 className="font-h2 text-h2 font-semibold text-on-surface mb-1">
                    Sentinel Data Scraper
                  </h2>
                  <p className="font-body-sub text-body-sub text-on-surface-variant line-clamp-2">
                    Autonomous agent dedicated to indexing public sentiment
                    across decentralized social graphs.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <span className="bg-surface-variant text-on-surface-variant font-label-caps text-label-caps font-semibold px-3 py-1 rounded-full">
                  Data
                </span>
                <span className="bg-surface-variant text-on-surface-variant font-label-caps text-label-caps font-semibold px-3 py-1 rounded-full">
                  LLM
                </span>
              </div>
            </div>

            {/* Agent Card 2 */}
            <div className="bg-surface rounded-xl p-md border border-outline-variant shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-shadow flex flex-col justify-between h-64">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 rounded-lg bg-surface-container flex items-center justify-center border border-outline-variant">
                    <span
                      className="material-symbols-outlined text-secondary text-2xl"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      analytics
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-surface-bright border border-outline-variant px-2 py-1 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-[#9CA3AF]" />
                    <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant">
                      Idle
                    </span>
                  </div>
                </div>
                <div>
                  <h2 className="font-h2 text-h2 font-semibold text-on-surface mb-1">
                    Yield Optimizer Alpha
                  </h2>
                  <p className="font-body-sub text-body-sub text-on-surface-variant line-clamp-2">
                    Monitors liquidity pools and executes rebalancing strategies
                    when thresholds are met.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <span className="bg-surface-variant text-on-surface-variant font-label-caps text-label-caps font-semibold px-3 py-1 rounded-full">
                  DeFi
                </span>
                <span className="bg-surface-variant text-on-surface-variant font-label-caps text-label-caps font-semibold px-3 py-1 rounded-full">
                  Trading
                </span>
              </div>
            </div>

            {/* Create New Card */}
            <Link
              href="/create"
              className="bg-surface-container-low rounded-xl p-md border border-dashed border-outline-variant hover:border-primary hover:bg-surface-container transition-all flex flex-col items-center justify-center h-64 gap-4 group cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full bg-surface-bright flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                <span
                  className="material-symbols-outlined text-primary"
                  style={{ fontVariationSettings: "'FILL' 0" }}
                >
                  add
                </span>
              </div>
              <span className="font-h2 text-h2 font-semibold text-on-surface-variant group-hover:text-primary transition-colors">
                Deploy New Agent
              </span>
            </Link>
          </div>

          {/* Recent Task Activity */}
          <div className="mt-lg">
            <h3 className="font-h2 text-h2 font-semibold text-on-surface mb-6 border-b border-outline-variant pb-2">
              Recent Task Activity
            </h3>
            <div className="bg-surface rounded-xl border border-outline-variant shadow-[0px_4px_20px_rgba(0,0,0,0.05)] overflow-hidden">
              <div className="grid grid-cols-12 gap-4 p-4 border-b border-outline-variant bg-surface-container-low font-label-caps text-label-caps font-semibold text-on-surface-variant uppercase tracking-wider">
                <div className="col-span-4 md:col-span-3">Task ID</div>
                <div className="col-span-4 md:col-span-4">Agent</div>
                <div className="hidden md:block col-span-2">Status</div>
                <div className="col-span-4 md:col-span-3 text-right">
                  Last Run
                </div>
              </div>
              <div className="flex flex-col">
                {taskRows.map((row, i) => (
                  <div
                    key={row.id}
                    className={`grid grid-cols-12 gap-4 p-4 items-center hover:bg-surface-container-low transition-colors ${
                      i < taskRows.length - 1
                        ? "border-b border-surface-variant"
                        : ""
                    }`}
                  >
                    <div className="col-span-4 md:col-span-3 font-data-mono text-data-mono text-primary">
                      {row.id}
                    </div>
                    <div className="col-span-4 md:col-span-4 font-body-main text-body-main text-on-surface truncate">
                      {row.agent}
                    </div>
                    <div className="hidden md:flex col-span-2 items-center gap-2">
                      <StatusIcon status={row.status} />
                      <span className="font-body-sub text-body-sub text-on-surface-variant capitalize">
                        {row.status}
                      </span>
                    </div>
                    <div className="col-span-4 md:col-span-3 text-right font-data-mono text-data-mono text-on-surface-variant">
                      {row.lastRun}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "automations" && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-on-surface-variant">
          <span
            className="material-symbols-outlined text-5xl"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            auto_awesome
          </span>
          <p className="font-body-main text-body-main">
            No automations configured yet.
          </p>
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
