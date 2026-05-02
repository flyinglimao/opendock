"use client";

import { type FormEvent, useState, useEffect, useRef, useCallback } from "react";
import AgentCard, { AgentCardData } from "@/components/AgentCard";

interface AgentItem {
  tokenId: string;
  name: string | null;
  description: string | null;
  image: string | null;
  rentPricePerSecond: string | null;
  rentOrderId: string | null;
  rentalCount: number;
}

interface AgentsResponse {
  items: AgentItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Convert wei/second to "X 0G/hr" display string
function formatPrice(weiPerSecond: string | null): string {
  if (!weiPerSecond || weiPerSecond === "0") return "Free";
  try {
    const wps = BigInt(weiPerSecond);
    // hourly milli-0G = wps * 3600 / 10^15
    const hourlyMilliOG = (wps * 3600n) / 1_000_000_000_000_000n;
    const n = Number(hourlyMilliOG) / 1000;
    if (n < 0.001) return "<0.001 0G/hr";
    if (n < 1) return `${n.toFixed(3)} 0G/hr`;
    return `${n.toFixed(2)} 0G/hr`;
  } catch {
    return "—";
  }
}

function toCardData(item: AgentItem): AgentCardData {
  return {
    id: item.tokenId,
    name: item.name ?? `Agent #${item.tokenId}`,
    tags: [],
    status: "live",
    price: formatPrice(item.rentPricePerSecond),
    rentalCount: item.rentalCount,
    imageUrl: item.image ?? "",
    imageAlt: item.name ?? `Agent #${item.tokenId}`,
  };
}

function SkeletonCard() {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden animate-pulse">
      <div className="aspect-square bg-surface-container-high" />
      <div className="p-md flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-4 bg-surface-container-high rounded w-3/4" />
          <div className="h-3 bg-surface-container-high rounded w-1/2" />
        </div>
        <div className="flex items-center justify-between mt-auto">
          <div className="flex flex-col gap-1">
            <div className="h-3 bg-surface-container-high rounded w-10" />
            <div className="h-4 bg-surface-container-high rounded w-20" />
          </div>
          <div className="h-8 bg-surface-container-high rounded w-16" />
        </div>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="flex items-center justify-center w-9 h-9 rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          chevron_left
        </span>
      </button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="w-9 h-9 flex items-center justify-center text-outline font-label-caps text-label-caps">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            className={`w-9 h-9 rounded border font-label-caps text-label-caps transition-colors ${
              p === page
                ? "bg-primary border-primary text-on-primary"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="flex items-center justify-center w-9 h-9 rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          chevron_right
        </span>
      </button>
    </div>
  );
}

export default function ExplorePage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchRequestId, setSearchRequestId] = useState(0);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState<"rentals" | "price">("rentals");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);

  const [trending, setTrending] = useState<AgentItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);

  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLElement>(null);

  const scrollToList = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const submitSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDebouncedSearch(search.trim());
    setPage(1);
    setSearchRequestId((id) => id + 1);
    scrollToList();
  }, [search, scrollToList]);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Fetch trending agents once
  useEffect(() => {
    let ignore = false;

    queueMicrotask(() => {
      if (ignore) return;
      setTrendingLoading(true);
      fetch("/api/agents?trending=true&sortBy=rentals&sortOrder=desc")
        .then((r) => r.json())
        .then((data: AgentsResponse) => {
          if (!ignore) setTrending(data.items);
        })
        .catch(() => {
          if (!ignore) setTrending([]);
        })
        .finally(() => {
          if (!ignore) setTrendingLoading(false);
        });
    });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams({
      page: String(page),
      sortBy,
      sortOrder,
    });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);

    queueMicrotask(() => {
      if (ignore) return;
      setListLoading(true);
      fetch(`/api/agents?${params}`)
        .then((r) => r.json())
        .then((data: AgentsResponse) => {
          if (ignore) return;
          setAgents(data.items);
          setTotalPages(data.totalPages);
          setTotal(data.total);
        })
        .catch(() => {
          if (!ignore) setAgents([]);
        })
        .finally(() => {
          if (!ignore) setListLoading(false);
        });
    });

    return () => {
      ignore = true;
    };
  }, [page, sortBy, sortOrder, debouncedSearch, minPrice, maxPrice, searchRequestId]);

  // Reset page when filters change (except page itself)
  const handleFilterChange = useCallback(() => {
    setPage(1);
  }, []);

  const handleSortByChange = (val: "rentals" | "price") => {
    setSortBy(val);
    handleFilterChange();
  };

  const handleSortOrderChange = (val: "desc" | "asc") => {
    setSortOrder(val);
    handleFilterChange();
  };

  const handleMinPriceChange = (val: string) => {
    setMinPrice(val);
    handleFilterChange();
  };

  const handleMaxPriceChange = (val: string) => {
    setMaxPrice(val);
    handleFilterChange();
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    scrollToList();
  };

  const handleHeroSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitSearch();
  };

  return (
    <main className="flex-grow w-full max-w-[1280px] mx-auto px-6 py-12 flex flex-col gap-12">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center text-center py-20 gap-8">
        <h1 className="font-h1 text-h1 font-bold text-on-background max-w-3xl">
          Discover &amp; Rent AI Agents.
        </h1>
        <p className="font-body-sub text-body-sub text-on-surface-variant max-w-2xl">
          Access a decentralized marketplace of specialized AI models. Rent agent
          capabilities and integrate them securely into your workflows.
        </p>
        <form
          onSubmit={handleHeroSearchSubmit}
          className="w-full max-w-2xl mt-4 flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1 min-w-0">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents by name or description..."
              className="h-14 w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-12 pr-4 font-body-main text-body-main text-on-surface shadow-[0px_4px_20px_rgba(0,0,0,0.05)] outline-none transition-all placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>
          <button
            type="submit"
            className="h-14 shrink-0 rounded-lg bg-primary px-6 font-label-caps text-label-caps font-semibold text-on-primary transition-colors hover:bg-primary-container"
          >
            Search
          </button>
        </form>
      </section>

      {/* Trending Agents */}
      <section className="flex flex-col gap-6">
        <h2 className="font-h2 text-h2 font-semibold text-on-background">
          Trending Agents
        </h2>

        {trendingLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : trending.length === 0 ? (
          <p className="font-body-sub text-body-sub text-on-surface-variant">
            No agents listed yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {trending.map((item) => (
              <AgentCard key={item.tokenId} agent={toCardData(item)} actionLabel="Rent" />
            ))}
          </div>
        )}
      </section>

      {/* All Agents Listing */}
      <section ref={listRef} className="flex flex-col gap-6">
        <h2 className="font-h2 text-h2 font-semibold text-on-background">
          All Agents
        </h2>

        {/* Filters */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(280px,1fr)_180px_180px_208px_200px] md:items-end">
          {/* Search (synced with hero) */}
          <div className="flex min-w-0 flex-col gap-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Search
            </label>
            <div className="relative">
              <span
                className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline"
                style={{ fontSize: 18 }}
              >
                search
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSearch();
                }}
                placeholder="Search agents..."
                className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-10 pr-3 font-body-sub text-body-sub text-on-surface outline-none transition-all placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>

          {/* Min Price */}
          <div className="flex min-w-0 flex-col gap-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Min Price (0G/hr)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={minPrice}
              onChange={(e) => handleMinPriceChange(e.target.value)}
              placeholder="0"
              className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body-sub text-body-sub text-on-surface outline-none transition-all placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          {/* Max Price */}
          <div className="flex min-w-0 flex-col gap-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Max Price (0G/hr)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={maxPrice}
              onChange={(e) => handleMaxPriceChange(e.target.value)}
              placeholder="Any"
              className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body-sub text-body-sub text-on-surface outline-none transition-all placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          {/* Sort By */}
          <div className="flex min-w-0 flex-col gap-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => handleSortByChange(e.target.value as "rentals" | "price")}
              className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body-sub text-body-sub text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="rentals">Rental Count</option>
              <option value="price">Price</option>
            </select>
          </div>

          {/* Sort Order */}
          <div className="flex min-w-0 flex-col gap-2">
            <label className="font-label-caps text-label-caps text-on-surface-variant">
              Order
            </label>
            <select
              value={sortOrder}
              onChange={(e) => handleSortOrderChange(e.target.value as "desc" | "asc")}
              className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body-sub text-body-sub text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="desc">High → Low</option>
              <option value="asc">Low → High</option>
            </select>
          </div>
        </div>

        {/* Results count */}
        {!listLoading && (
          <p className="font-body-sub text-body-sub text-on-surface-variant">
            {total === 0
              ? "No agents found."
              : `${total} agent${total !== 1 ? "s" : ""} found`}
          </p>
        )}

        {/* Grid */}
        {listLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-on-surface-variant">
            <span className="material-symbols-outlined" style={{ fontSize: 48 }}>
              search_off
            </span>
            <p className="font-body-sub text-body-sub">No agents match your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {agents.map((item) => (
              <AgentCard key={item.tokenId} agent={toCardData(item)} actionLabel="Rent" />
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onChange={handlePageChange} />
      </section>
    </main>
  );
}
