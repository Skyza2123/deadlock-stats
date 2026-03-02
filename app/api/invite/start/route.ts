import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { pool } from "@/lib";

function hashInvite(code: string) {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const inviteCode = String(body?.inviteCode ?? "").trim();
  if (!inviteCode) return NextResponse.json({ error: "Missing invite code" }, { status: 400 });

  const codeHash = hashInvite(inviteCode);

  const { rows } = await pool.query(
    `SELECT expires_at, max_uses, uses FROM invite_codes WHERE code_hash = $1`,
    [codeHash]
  );

  if (rows.length === 0) return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });

  const inv = rows[0];
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 403 });
  }
  if (Number(inv.uses) >= Number(inv.max_uses)) {
    return NextResponse.json({ error: "Invite used up" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto
    ? forwardedProto.includes("https")
    : req.nextUrl.protocol === "https:";

  res.cookies.set("pending_invite", codeHash, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 10 * 60,
  });

  return res;
}