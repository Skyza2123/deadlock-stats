import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as Session | null;
  const steamId = (session?.user as any)?.id as string | undefined;

  if (!steamId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  return NextResponse.json({ steamId });
}