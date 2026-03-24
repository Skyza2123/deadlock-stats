import type { NextAuthOptions } from "next-auth";
import Steam from "next-auth-steam";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { pool } from "@/lib";

const AUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "local-dev-auth-secret-change-me";

const baseAuthOptions: NextAuthOptions = {
  secret: AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "steam") return true;

      const rawSteamId = String(
        (profile as any)?.steamid ??
          (profile as any)?.id ??
          user?.id ??
          ""
      ).trim();

      if (!rawSteamId) return true;

      const displayName = String(
        (profile as any)?.personaname ??
          user?.name ??
          ""
      ).trim() || null;

      const profileUrl = String((profile as any)?.profileurl ?? "").trim() || null;
      const avatar = String((profile as any)?.avatar ?? "").trim() || null;
      const avatarMedium = String((profile as any)?.avatarmedium ?? "").trim() || null;
      const avatarFull = String((profile as any)?.avatarfull ?? "").trim() || null;

      try {
        await pool.query(
          `INSERT INTO players (steam_id, display_name, profile_url, avatar, avatar_medium, avatar_full)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (steam_id)
           DO UPDATE SET
             display_name = EXCLUDED.display_name,
             profile_url = EXCLUDED.profile_url,
             avatar = EXCLUDED.avatar,
             avatar_medium = EXCLUDED.avatar_medium,
             avatar_full = EXCLUDED.avatar_full`,
          [rawSteamId, displayName, profileUrl, avatar, avatarMedium, avatarFull]
        );
      } catch {
        try {
          await pool.query(
            `INSERT INTO players (steam_id, display_name)
             VALUES ($1, $2)
             ON CONFLICT (steam_id)
             DO UPDATE SET display_name = EXCLUDED.display_name`,
            [rawSteamId, displayName]
          );
        } catch {
          // Do not block authentication if player upsert fails.
        }
      }

      return true;
    },
    async jwt({ token, user, account }) {
      // Prefix ids so both account types coexist cleanly
      if (user?.id) {
        const provider = account?.provider;
        const prefix = provider === "steam" ? "steam:" : provider === "credentials" ? "user:" : "";
        token.sub = prefix + String(user.id);
      }

      if ((user as any)?.isAdmin) {
        (token as any).isAdmin = true;
      }

      if (!(token as any).isAdmin) {
        const authEmail = String(process.env.AUTH_EMAIL ?? "").trim().toLowerCase();
        const tempAdminEmail = String(process.env.TEMP_ADMIN_EMAIL ?? "").trim().toLowerCase();
        const tokenEmail = String(token.email ?? "").trim().toLowerCase();
        if (tokenEmail && (tokenEmail === authEmail || tokenEmail === tempAdminEmail)) {
          (token as any).isAdmin = true;
        }
      }

      if (user?.name) token.name = user.name;
      if (user?.email) token.email = user.email;
      if ((user as any)?.image) (token as any).picture = (user as any).image;

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub ? String(token.sub) : undefined;
        (session.user as any).isAdmin = Boolean((token as any).isAdmin);

        if (token.name) session.user.name = String(token.name);
        if (token.email) session.user.email = String(token.email);
        if ((token as any).picture) (session.user as any).image = String((token as any).picture);
      }
      return session;
    },
  },
};

export function getAuthOptions(req?: any): NextAuthOptions {
  const steamSecret = process.env.STEAM_SECRET?.trim();
  const nextAuthUrl = process.env.NEXTAUTH_URL?.trim();

  const providers = [] as NextAuthOptions["providers"];

  // next-auth-steam needs a req object to build the Steam callback URL.
  // When no actual request is available (e.g. module-level export or getServerSession),
  // synthesise a minimal compatible object from NEXTAUTH_URL.
  const effectiveReq =
    req ??
    (nextAuthUrl
      ? { headers: { host: new URL(nextAuthUrl).host } }
      : null);

  // Steam login (primary)
  if (effectiveReq && steamSecret) {
    providers.push(
      Steam(effectiveReq, {
        clientSecret: steamSecret,
      })
    );
  }

  // DB-backed credentials login (temp accounts / real accounts)
  providers.push(
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase() ?? "";
        const password = credentials?.password ?? "";

        if (!email || !password) return null;

        const tempAdminEmail = process.env.TEMP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
        const tempAdminPassword = process.env.TEMP_ADMIN_PASSWORD ?? "";

        if (tempAdminEmail && tempAdminPassword && email === tempAdminEmail && password === tempAdminPassword) {
          return {
            id: "temp-admin",
            email: tempAdminEmail,
            name: "Temporary Admin",
            isAdmin: true,
          };
        }

        const tempEmail = process.env.AUTH_EMAIL?.trim().toLowerCase() ?? "";
        const tempPassword = process.env.AUTH_PASSWORD ?? "";

        if (tempEmail && tempPassword && email === tempEmail && password === tempPassword) {
          return {
            id: "temp-new-user",
            email: tempEmail,
            name: "Temp User",
            isAdmin: true,
          };
        }

        const { rows } = await pool.query(
          `SELECT id, email, password_hash, display_name
           FROM app_users
           WHERE email = $1
           LIMIT 1`,
          [email]
        );

        if (rows.length === 0) return null;

        const u = rows[0];
        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok) return null;

        return {
          id: String(u.id), // becomes user:<id> in jwt callback
          email: u.email,
          name: u.display_name ?? u.email,
        };
      },
    })
  );

  return { ...baseAuthOptions, providers };
}

export const authOptions = getAuthOptions();