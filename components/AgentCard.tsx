import Link from "next/link";
import Image from "next/image";
import StatusBadge from "./StatusBadge";
import Chip from "./Chip";

export interface AgentCardData {
  id: string;
  name: string;
  tags: string[];
  status: "live" | "idle";
  price: string;
  imageUrl: string;
  imageAlt: string;
}

interface AgentCardProps {
  agent: AgentCardData;
}

export default function AgentCard({ agent }: AgentCardProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0px_10px_30px_rgba(0,0,0,0.08)] transition-all duration-300 border border-outline-variant overflow-hidden flex flex-col group">
      <div className="aspect-square w-full relative overflow-hidden bg-surface-container-high">
        <Image
          src={agent.imageUrl}
          alt={agent.imageAlt}
          fill
          className="object-cover group-hover:scale-105 transition-transform duration-500"
          unoptimized
        />
        <div className="absolute top-2 right-2">
          <StatusBadge status={agent.status} />
        </div>
      </div>

      <div className="p-md flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-body-main text-body-main font-semibold text-on-background">
            {agent.name}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {agent.tags.map((tag) => (
              <Chip key={tag} label={tag} />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mt-auto">
          <div className="flex flex-col">
            <span className="font-label-caps text-label-caps font-semibold text-outline">
              Price
            </span>
            <span className="font-data-mono text-data-mono text-primary font-semibold">
              {agent.price}
            </span>
          </div>
          <Link
            href={`/agents/${agent.id}`}
            className="bg-white border border-outline-variant text-on-surface px-4 py-2 rounded font-label-caps text-label-caps font-semibold hover:bg-surface-container transition-colors"
          >
            View
          </Link>
        </div>
      </div>
    </div>
  );
}
