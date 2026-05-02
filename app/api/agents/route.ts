import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 12;

// Convert display price (0G/hr) to wei/second string for DB comparison
function hourlyToWeiPerSecond(hourly: number): string {
  // Scale to 9 decimal places to preserve precision, then use BigInt
  const scaled = Math.round(hourly * 1e9);
  return (BigInt(scaled) * 1_000_000_000n / 3600n).toString();
}

type AgentRow = {
  tokenId: string;
  name: string | null;
  description: string | null;
  image: string | null;
  rentPricePerSecond: string | null;
  rentOrderId: string | null;
  rentalCount: number;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1") || 1);
  const sortBy = sp.get("sortBy") ?? "rentals"; // "price" | "rentals"
  const sortOrder = sp.get("sortOrder") === "asc" ? "ASC" : "DESC";
  const minPriceStr = sp.get("minPrice");
  const maxPriceStr = sp.get("maxPrice");
  const trending = sp.get("trending") === "true";

  const limit = trending ? 4 : PAGE_SIZE;
  const skip = trending ? 0 : (page - 1) * PAGE_SIZE;

  const params: (string | number)[] = [];
  const conditions: string[] = [
    `at."rentOrderId" IS NOT NULL`,
    `at."metadataReady" = true`,
  ];

  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    conditions.push(`(at."name" ILIKE ${p} OR at."description" ILIKE ${p})`);
  }

  const minPriceHr = minPriceStr ? parseFloat(minPriceStr) : NaN;
  if (!isNaN(minPriceHr) && minPriceHr >= 0) {
    params.push(hourlyToWeiPerSecond(minPriceHr));
    conditions.push(`NULLIF(at."rentPricePerSecond", '')::numeric >= $${params.length}`);
  }

  const maxPriceHr = maxPriceStr ? parseFloat(maxPriceStr) : NaN;
  if (!isNaN(maxPriceHr) && maxPriceHr >= 0) {
    params.push(hourlyToWeiPerSecond(maxPriceHr));
    conditions.push(`NULLIF(at."rentPricePerSecond", '')::numeric <= $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");
  const orderByClause =
    sortBy === "price"
      ? `NULLIF(at."rentPricePerSecond", '')::numeric ${sortOrder} NULLS LAST`
      : `"rentalCount" ${sortOrder}`;

  const sql = `
    SELECT
      at."tokenId",
      at."name",
      at."description",
      at."image",
      at."rentPricePerSecond",
      at."rentOrderId",
      COALESCE(COUNT(cw.id)::int4, 0) AS "rentalCount"
    FROM "AgentToken" at
    LEFT JOIN "AgentComputeWallet" cw ON cw."tokenId" = at."tokenId"
    WHERE ${whereClause}
    GROUP BY at."tokenId"
    ORDER BY ${orderByClause}
    LIMIT ${limit} OFFSET ${skip}
  `;

  const countSql = `
    SELECT COUNT(DISTINCT at."tokenId")::int4 AS total
    FROM "AgentToken" at
    WHERE ${whereClause}
  `;

  const [items, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<AgentRow[]>(sql, ...params),
    trending
      ? Promise.resolve([{ total: 0 }] as { total: number }[])
      : prisma.$queryRawUnsafe<{ total: number }[]>(countSql, ...params),
  ]);

  const total = countRows[0]?.total ?? 0;

  return NextResponse.json({
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
  });
}
