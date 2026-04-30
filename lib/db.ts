// lib/db.ts
// Prisma client singleton — safe to import in both server components and API routes.
// Uses a global variable in development to avoid re-creating connections on hot-reload.

import { PrismaClient } from "@/app/generated/prisma";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
