import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { getAuthOptions } from "@/lib/auth";

export const runtime = "nodejs";

async function handler(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
	return NextAuth(req, ctx, getAuthOptions(req));
}

export { handler as GET, handler as POST };