import DashboardTabs from "./DashboardTabs";

export const metadata = {
  title: "Dashboard - OpenDock",
};

export default function DashboardPage() {
  return (
    <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-xl flex flex-col gap-xl">
      {/* Header */}
      <header className="flex flex-col gap-sm md:flex-row md:items-end md:justify-between border-b border-outline-variant pb-lg">
        <div className="flex flex-col gap-md">
          <div className="flex items-center gap-sm bg-surface-container-high px-3 py-1.5 rounded-full w-fit border border-outline-variant">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-tertiary-container shadow-inner" />
            <span className="font-data-mono text-data-mono text-on-surface-variant">
              0x7F4A...B29C
            </span>
          </div>

          <div className="flex flex-col">
            <span className="font-label-caps text-label-caps font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
              Total 0G Balance
            </span>
            <div className="flex items-baseline gap-2">
              <h1 className="font-h1 text-h1 font-bold text-on-background">
                1,245,890
              </h1>
              <span className="font-h2 text-h2 font-semibold text-outline">
                .00
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-4 mt-6 md:mt-0">
          <button className="bg-surface border border-outline-variant text-on-surface font-body-sub text-body-sub px-4 py-2 rounded-lg hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-all flex items-center gap-2">
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              swap_horiz
            </span>
            Transfer
          </button>
          <button className="bg-primary text-on-primary font-body-sub text-body-sub px-4 py-2 rounded-lg shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-all flex items-center gap-2">
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              add
            </span>
            Deposit
          </button>
        </div>
      </header>

      <DashboardTabs />
    </main>
  );
}
