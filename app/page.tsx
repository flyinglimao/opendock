import Link from "next/link";
import AgentCard, { AgentCardData } from "@/components/AgentCard";

const trendingAgents: AgentCardData[] = [
  {
    id: "nexus-llm-v2",
    name: "Nexus LLM v2",
    tags: ["NLP", "Code"],
    status: "live",
    price: "150 0G",
    imageUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDdeF-6ycrf27j2WMBF2iRwoI7yHr2NMyqj0aiI_3YvJkB-UbJwGC10vWzSk5VOcTNmQdS6lvO5klnC_3qh15BQ_fNgevKZNRYaMqnY9mSAykr9QxSrVHobmQNu7RFLOkwqt3vaAGXmo9IK8jtQwKiDw_daQDCUnLmN_j6lhJ42rE6edyZdJe_7G0Dimak2eoH_wlYGpgROBqQewu9HEWkO3bk0ejv2TtXRZpfOish_Qh9vZQrtNEbVY4w05-QDyNfSfYOBgeRFkLO5",
    imageAlt: "Abstract 3d neural network rendering in deep blues and purples",
  },
  {
    id: "visionary-ai",
    name: "Visionary AI",
    tags: ["Vision", "Gen"],
    status: "live",
    price: "220 0G",
    imageUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuC_LFbQCaepqAUX_23ZOQBAnVYmnMmnwgou3KCTiwuWnF-HvyqNzy1JmAmjJ_SVNdenK-qbgxxuENyxd3OUnqTXiq4SqxtiMMzJWe_CW-c0eCulOwobDYeNCS5MhGWk6Q6lZhL1ICqBPUOhBoJGg1cgzLjulT-yZtRzc5WuNqHuTmaGhw6wITzswXGlK-B2MFDi9nHW__fQjKQMqulvrqHyDSq05c-2g9XNHfCo7mA0f5oi_T2T-udXbrxrLHjWPZhub7pSuLX-C-IM",
    imageAlt: "Minimalist abstract geometric shapes in clean white space",
  },
  {
    id: "dataminer-pro",
    name: "DataMiner Pro",
    tags: ["Analysis"],
    status: "idle",
    price: "85 0G",
    imageUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuB_Aq6RlgivMkmE9pstYgrUmVdz_aZRR23XRWuBfYp5FKouQrToqFe8pX1lA3UUw8uXcVL36-Pzgb0PqAIaltgc6CmUWVuyRgXprziKw2JWP3jfZzutGH5LaDy3IQyQWFEbT2LJK3n9IhZV1Br2TQlfOX5-mvKzgZN9rJTZgLBiCoVElI10bLtX0HyaBNCIX42dDziSCxO1DuqodjrODX6i3mxic_kri-L9vbSwrygN6_DSqCWJ3XEHKTnB3fIN6iC5d_VyQYP75JS4",
    imageAlt: "High tech server room corridor with cool blue LED lighting",
  },
  {
    id: "autotrader-bot",
    name: "AutoTrader Bot",
    tags: ["DeFi", "Quant"],
    status: "live",
    price: "300 0G",
    imageUrl:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuC6i2Oqx9FKPU5-5FstqS7LaERBTArHdgAZUenAGQQQFwMxpU_bJ5jUZIKjbT22JaGAq9v3v5thKeLSgZd-FyhjAIKHFDRs_eRx5cjOuD-4cqfmGGwd34IaAsFH3_Whz8wlTAz-cVe54KutTRmaxgzF1RQMfAjXK2Xzim_oHsbxbLZtvnRyBixMm9uYPOq3ASYCZi4L8Q6_FFkT75TxEomKkESWFvzXlC2YL9E4RyM9_TfOQoNv0Jm_ozV5cPlIY-8Vh5x21H7edEht",
    imageAlt: "Macro photography of liquid metallic surface in silver tones",
  },
];

export default function ExplorePage() {
  return (
    <main className="flex-grow w-full max-w-[1280px] mx-auto px-6 py-12 flex flex-col gap-12">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center text-center py-20 gap-8">
        <h1 className="font-h1 text-h1 font-bold text-on-background max-w-3xl">
          Discover &amp; Trade AI Agents.
        </h1>
        <p className="font-body-sub text-body-sub text-on-surface-variant max-w-2xl">
          Access a decentralized marketplace of specialized AI models. Deploy,
          integrate, or trade agent capabilities securely.
        </p>
        <div className="w-full max-w-xl relative mt-4">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">
            search
          </span>
          <input
            type="text"
            placeholder="Search agents by name, capability, or tag..."
            className="w-full pl-12 pr-4 py-4 rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all shadow-[0px_4px_20px_rgba(0,0,0,0.05)] font-body-main text-body-main placeholder:text-outline"
          />
        </div>
      </section>

      {/* Trending Agents Grid */}
      <section className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="font-h2 text-h2 font-semibold text-on-background">
            Trending Agents
          </h2>
          <Link
            href="#"
            className="font-label-caps text-label-caps font-semibold text-primary hover:underline flex items-center gap-1"
          >
            View All{" "}
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              arrow_forward
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
          {trendingAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </section>
    </main>
  );
}
