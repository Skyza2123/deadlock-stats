import NextAuth from "next-auth";
import { type NextRequest } from "next/server";
import { getAuthOptions } from "@/lib/auth";

// Recreate the handler per request so next-auth-steam receives the real
// incoming request and can build the correct Steam callback URL.
export async function GET(req: NextRequest, context: any) {
  const handler = NextAuth(getAuthOptions(req));
  return (handler as any)(req, context);
}

export async function POST(req: NextRequest, context: any) {
  const handler = NextAuth(getAuthOptions(req));
  return (handler as any)(req, context);
}