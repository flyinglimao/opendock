interface ChipProps {
  label: string;
  variant?: "default" | "pill";
}

export default function Chip({ label, variant = "default" }: ChipProps) {
  if (variant === "pill") {
    return (
      <span className="bg-surface-variant text-on-surface-variant font-label-caps text-label-caps font-semibold px-3 py-1 rounded-full">
        {label}
      </span>
    );
  }
  return (
    <span className="bg-surface-container text-on-surface-variant font-label-caps text-[10px] font-semibold px-2 py-1 rounded tracking-wide">
      {label}
    </span>
  );
}
