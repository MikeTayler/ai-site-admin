import { ensureDatabaseUrlFromVercelNeon } from "@/lib/db-env";
import { PrismaClient } from "@prisma/client";

ensureDatabaseUrlFromVercelNeon();

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
