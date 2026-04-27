type Status = "live" | "idle";

interface StatusBadgeProps {
  status: Status;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const isLive = status === "live";
  return (
    <div className="bg-surface-container-lowest/90 backdrop-blur-sm rounded-full px-2 py-1 flex items-center gap-1 border border-outline-variant/30">
      <div
        className={`w-2 h-2 rounded-full ${isLive ? "bg-[#10B981]" : "bg-[#9CA3AF]"}`}
      />
      <span className="font-label-caps text-label-caps font-semibold text-on-surface">
        {isLive ? "Live" : "Idle"}
      </span>
    </div>
  );
}
