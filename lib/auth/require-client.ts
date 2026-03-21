import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { Client } from "@prisma/client";

export type RequireClientResult =
  | { ok: true; client: Client }
  | { ok: false; status: 401 | 404 | 500; error: string };

export async function requireClientForUser(): Promise<RequireClientResult> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    const client = await prisma.client.findUnique({
      where: { clerkUserId: userId },
    });
    if (!client) {
      return {
        ok: false,
        status: 404,
        error: "No site profile found for your account.",
      };
    }
    return { ok: true, client };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 500,
      error: `Session or database error: ${msg}`,
    };
  }
}
