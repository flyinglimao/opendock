import DashboardTabs from "./DashboardTabs";

export const metadata = {
  title: "Dashboard - OpenDock",
};

export default function DashboardPage() {
  return (
    <main className="flex-1 max-w-[1280px] mx-auto w-full px-6 py-xl">
      <DashboardTabs />
    </main>
  );
}
