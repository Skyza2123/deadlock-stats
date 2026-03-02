import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import crypto from "crypto";
import { db } from "../../db";
import { matchPlayers, matches, players, teamMemberships, teams } from "../../db/schema";
import { authOptions } from "../../lib/auth";
import TeamPlayerSearch from "@/components/TeamPlayerSearch";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseUploadedPlayers(input: string) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = new Map<string, { steamId: string; displayName: string | null }>();

  for (const line of lines) {
    const [rawId, ...rest] = line.split(/[|,]/);
    const steamId = rawId?.trim();
    const displayName = rest.join(",").trim() || null;

    if (!steamId) continue;
    if (!/^\d{5,20}$/.test(steamId)) continue;

    result.set(steamId, { steamId, displayName });
  }

  return [...result.values()];
}

async function fetchPersonaForAccountId(accountId: string, apiKey: string) {
  const url =
    "https://api.deadlock-api.com/v1/players/steam-search?search_query=" +
    encodeURIComponent(accountId);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!res.ok) return null;
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const exact = rows.find((item) => String(item?.account_id ?? "") === String(accountId));
  return exact ?? rows[0] ?? null;
}

function extractMembershipKey(session: { user?: { id?: string } } | null) {
  const rawUserId = String(session?.user?.id ?? "");
  if (rawUserId.startsWith("user:")) return rawUserId.slice(5);
  if (rawUserId.startsWith("steam:")) return rawUserId.slice(6);
  return "";
}

function isManagerRole(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "manager" || normalized === "owner";
}

function normalizeMemberRole(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "manager" || normalized === "owner") return "manager";
  return "player";
}

function memberRoleLabel(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "manager") return "manager";
  return "player";
}

function roleRank(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "owner") return 3;
  if (normalized === "manager") return 2;
  return 1;
}

function generateInviteCode() {
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `INV-${token}`;
}

function hashInvite(code: string) {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

function isAdminSession(session: { user?: { email?: string | null } } | null) {
  const adminEmail = String(process.env.AUTH_EMAIL ?? "").trim().toLowerCase();
  const sessionEmail = String(session?.user?.email ?? "").trim().toLowerCase();
  return Boolean(adminEmail) && sessionEmail === adminEmail;
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams?: Promise<{ inviteCode?: string; inviteTeam?: string; teamError?: string; inviteError?: string; actionError?: string; compareA?: string; compareB?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const isAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);

  if (!session) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-zinc-400">Team and roster data is hidden until you sign in.</p>
          <a href="/login" className="mt-4 inline-block rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm hover:bg-zinc-800">
            Go to login
          </a>
        </section>
      </main>
    );
  }

  const membershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
  if (!isAdmin && !membershipKey) {
    return (
      <main className="w-full p-6 md:p-8 space-y-4">
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-5">
          <h1 className="text-2xl font-bold">Invalid session</h1>
          <p className="mt-2 text-zinc-400">Could not resolve your user identity for team access.</p>
        </section>
      </main>
    );
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const inviteCodeNotice = String(resolvedSearchParams?.inviteCode ?? "").trim();
  const inviteTeamNotice = String(resolvedSearchParams?.inviteTeam ?? "").trim();
  const teamErrorNotice = String(resolvedSearchParams?.teamError ?? "").trim();
  const inviteErrorNotice = String(resolvedSearchParams?.inviteError ?? "").trim();
  const actionErrorNotice = String(resolvedSearchParams?.actionError ?? "").trim();
  const compareTeamASlugRaw = String(resolvedSearchParams?.compareA ?? "").trim();
  const compareTeamBSlugRaw = String(resolvedSearchParams?.compareB ?? "").trim();

  async function createTeamAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const name = String(formData.get("name") ?? "").trim();
    const slugInput = String(formData.get("slug") ?? "").trim();

    if (!name) return;

    const slug = slugify(slugInput || name);
    if (!slug) return;

    const existingByName = await db
      .select({ slug: teams.slug })
      .from(teams)
      .where(sql`lower(${teams.name}) = lower(${name})`)
      .limit(1);

    if (existingByName.length) {
      redirect("/teams?teamError=" + encodeURIComponent("A team with this name already exists."));
    }

    await db
      .insert(teams)
      .values({
        name,
        slug,
      })
      .onConflictDoNothing({
        target: teams.slug,
      });

    revalidatePath("/teams");
    redirect("/teams");
  }

  async function createInviteCodeAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const maxUses = Number(formData.get("maxUses") ?? 25);
    const days = Number(formData.get("days") ?? 30);

    if (!teamSlug) {
      redirect("/teams?inviteError=" + encodeURIComponent("Choose a team."));
    }

    if (!actionIsAdmin) {
      const managerMembership = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, actionMembershipKey),
            inArray(teamMemberships.role, ["manager", "owner"]),
            isNull(teamMemberships.endAt)
          )
        )
        .limit(1);

      if (!managerMembership.length) {
        redirect("/teams?inviteError=" + encodeURIComponent("Manager role required."));
      }
    }

    const teamLookup = await db
      .select({ teamId: teams.teamId })
      .from(teams)
      .where(eq(teams.slug, teamSlug))
      .limit(1);

    if (!teamLookup.length) {
      redirect("/teams?inviteError=" + encodeURIComponent("Team not found."));
    }

    const code = generateInviteCode();
    const codeHash = hashInvite(code);
    const expiresAt = new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000);

    const teamIdRaw = teamLookup[0].teamId;
    try {
      await db.execute(
        sql`INSERT INTO invite_codes (code_hash, team_id, expires_at, max_uses, uses, note)
            VALUES (${codeHash}, ${teamIdRaw}, ${expiresAt}, ${Math.max(1, maxUses)}, 0, ${`Team invite ${code}`})
            ON CONFLICT (code_hash) DO NOTHING`
      );
    } catch {
      const teamIdTypeRows = await db.execute(
        sql`select data_type from information_schema.columns where table_name = 'invite_codes' and column_name = 'team_id' limit 1`
      );

      if (!teamIdTypeRows.rows.length) {
        try {
          await db.execute(sql`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS team_id bigint`);
        } catch (alterErr: any) {
          redirect("/teams?inviteError=" + encodeURIComponent(String(alterErr?.message ?? "invite_codes.team_id column is missing. Run database migrations.")));
        }
      }

      const refreshedTypeRows = await db.execute(
        sql`select data_type from information_schema.columns where table_name = 'invite_codes' and column_name = 'team_id' limit 1`
      );

      if (!refreshedTypeRows.rows.length) {
        redirect("/teams?inviteError=" + encodeURIComponent("invite_codes.team_id still missing after repair. Run migrations."));
      }

      const teamIdType = String((refreshedTypeRows.rows[0] as any)?.data_type ?? "").toLowerCase();
      const normalizedTeamId = teamIdType.includes("char") || teamIdType === "text"
        ? String(teamIdRaw)
        : Number(teamIdRaw);

      try {
        await db.execute(
          sql`INSERT INTO invite_codes (code_hash, team_id, expires_at, max_uses, uses, note)
              VALUES (${codeHash}, ${normalizedTeamId}, ${expiresAt}, ${Math.max(1, maxUses)}, 0, ${`Team invite ${code}`})
              ON CONFLICT (code_hash) DO NOTHING`
        );
      } catch (error: any) {
        redirect("/teams?inviteError=" + encodeURIComponent(String(error?.message ?? "Failed to create invite code.")));
      }
    }

    redirect(`/teams?inviteCode=${encodeURIComponent(code)}&inviteTeam=${encodeURIComponent(teamSlug)}`);
  }

  async function uploadPlayersAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const payload = String(formData.get("players") ?? "");

    if (!teamSlug || !payload.trim()) return;

    if (!actionIsAdmin) {
      const allowedTeam = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, actionMembershipKey),
            inArray(teamMemberships.role, ["manager", "owner"]),
            isNull(teamMemberships.endAt)
          )
        )
        .limit(1);

      if (!allowedTeam.length) return;
    }

    const uploadedPlayers = parseUploadedPlayers(payload);
    if (!uploadedPlayers.length) return;
    const deadlockApiKey = String(process.env.DEADLOCK_API_KEY ?? "").trim();

    const steamIds = uploadedPlayers.map((entry) => entry.steamId);

    const existingActiveMemberships = await db
      .select({ steamId: teamMemberships.steamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.role, "manual"),
          isNull(teamMemberships.endAt),
          inArray(teamMemberships.steamId, steamIds)
        )
      );

    const existingSteamIds = new Set(existingActiveMemberships.map((row) => row.steamId));

    await db.transaction(async (tx) => {
      for (const entry of uploadedPlayers) {
        let resolvedDisplayName = entry.displayName;
        if (!resolvedDisplayName && deadlockApiKey) {
          const info = await fetchPersonaForAccountId(entry.steamId, deadlockApiKey);
          const fromApi = String(info?.personaname ?? "").trim();
          if (fromApi) resolvedDisplayName = fromApi;
        }

        await tx
          .insert(players)
          .values({
            steamId: entry.steamId,
            displayName: resolvedDisplayName,
          })
          .onConflictDoUpdate({
            target: players.steamId,
            set: {
              displayName: resolvedDisplayName,
            },
          });

        if (!existingSteamIds.has(entry.steamId)) {
          await tx.insert(teamMemberships).values({
            teamId: teamSlug,
            steamId: entry.steamId,
            role: "manual",
            startAt: new Date(),
            endAt: null,
          });
        }
      }
    });

    revalidatePath("/teams");
  }

  async function addPlayerFromDatabaseAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const playerSteamId = String(formData.get("playerSteamId") ?? "").trim();

    if (!teamSlug || !/^\d{5,20}$/.test(playerSteamId)) return;

    if (!actionIsAdmin) {
      const allowedTeam = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, actionMembershipKey),
            inArray(teamMemberships.role, ["manager", "owner"]),
            isNull(teamMemberships.endAt)
          )
        )
        .limit(1);

      if (!allowedTeam.length) return;
    }

    const existingPlayer = await db
      .select({ steamId: players.steamId })
      .from(players)
      .where(eq(players.steamId, playerSteamId))
      .limit(1);

    if (!existingPlayer.length) return;

    const existingMembership = await db
      .select({ steamId: teamMemberships.steamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, playerSteamId),
          eq(teamMemberships.role, "manual"),
          isNull(teamMemberships.endAt)
        )
      )
      .limit(1);

    if (!existingMembership.length) {
      await db.insert(teamMemberships).values({
        teamId: teamSlug,
        steamId: playerSteamId,
        role: "manual",
        startAt: new Date(),
        endAt: null,
      });
    }

    revalidatePath("/teams");
  }

  async function removePlayerFromTeamAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const playerSteamId = String(formData.get("playerSteamId") ?? "").trim();

    if (!teamSlug || !/^\d{5,20}$/.test(playerSteamId)) return;

    if (!actionIsAdmin && playerSteamId === actionMembershipKey) {
      redirect("/teams?actionError=" + encodeURIComponent("Use Leave team to leave your own team membership."));
    }

    if (!actionIsAdmin) {
      const allowedTeam = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, actionMembershipKey),
            inArray(teamMemberships.role, ["manager", "owner"]),
            isNull(teamMemberships.endAt)
          )
        )
        .limit(1);

      if (!allowedTeam.length) return;
    }

    await db
      .update(teamMemberships)
      .set({ endAt: new Date() })
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, playerSteamId),
          inArray(teamMemberships.role, ["manual", "player", "member", "manager", "owner"]),
          isNull(teamMemberships.endAt)
        )
      );

    revalidatePath("/teams");
    revalidatePath(`/teams/${teamSlug}`);
  }

  async function changeMemberRoleAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const playerSteamId = String(formData.get("playerSteamId") ?? "").trim();
    const nextRoleRaw = String(formData.get("nextRole") ?? "").trim().toLowerCase();
    const nextRole = nextRoleRaw === "manager" ? "manager" : nextRoleRaw === "player" ? "player" : "";

    if (!teamSlug || !playerSteamId || !nextRole) return;

    if (!actionIsAdmin) {
      const managerMembership = await db
        .select({ teamId: teamMemberships.teamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, actionMembershipKey),
            inArray(teamMemberships.role, ["manager", "owner"]),
            isNull(teamMemberships.endAt)
          )
        )
        .limit(1);

      if (!managerMembership.length) return;
    }

    if (!actionIsAdmin && playerSteamId === actionMembershipKey && nextRole === "player") {
      redirect("/teams?actionError=" + encodeURIComponent("You cannot demote yourself."));
    }

    await db
      .update(teamMemberships)
      .set({ role: nextRole })
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, playerSteamId),
          inArray(teamMemberships.role, ["manual", "player", "member", "manager", "owner"]),
          isNull(teamMemberships.endAt)
        )
      );

    revalidatePath("/teams");
    revalidatePath(`/teams/${teamSlug}`);
  }

  async function transferOwnerAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const playerSteamId = String(formData.get("playerSteamId") ?? "").trim();
    if (!teamSlug || !playerSteamId) return;

    if (!actionIsAdmin) {
      const isOwner = await db
        .select({ steamId: teamMemberships.steamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, actionMembershipKey),
            eq(teamMemberships.role, "owner"),
            isNull(teamMemberships.endAt)
          )
        )
        .limit(1);

      if (!isOwner.length) {
        redirect("/teams?actionError=" + encodeURIComponent("Only the current owner can transfer ownership."));
      }
    }

    const targetMembership = await db
      .select({ steamId: teamMemberships.steamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, playerSteamId),
          isNull(teamMemberships.endAt)
        )
      )
      .limit(1);

    if (!targetMembership.length) {
      redirect("/teams?actionError=" + encodeURIComponent("Target user is not an active team member."));
    }

    await db.transaction(async (tx) => {
      await tx
        .update(teamMemberships)
        .set({ role: "manager" })
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.role, "owner"),
            isNull(teamMemberships.endAt)
          )
        );

      await tx
        .update(teamMemberships)
        .set({ role: "owner" })
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            eq(teamMemberships.steamId, playerSteamId),
            isNull(teamMemberships.endAt)
          )
        );
    });

    revalidatePath("/teams");
    revalidatePath(`/teams/${teamSlug}`);
  }

  async function leaveTeamAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    if (!teamSlug) return;

    await db
      .update(teamMemberships)
      .set({ endAt: new Date() })
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, actionMembershipKey),
          inArray(teamMemberships.role, ["player", "manager", "owner", "member"]),
          isNull(teamMemberships.endAt)
        )
      );

    revalidatePath("/teams");
    revalidatePath(`/teams/${teamSlug}`);
  }

  async function deleteTeamAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionMembershipKey) return;

    const teamSlug = String(formData.get("teamSlug") ?? "").trim();
    const confirmText = String(formData.get("confirmText") ?? "").trim();
    if (!teamSlug) return;
    if (confirmText !== "DELETE") {
      redirect("/teams?actionError=" + encodeURIComponent("Type DELETE to confirm team deletion."));
    }

    const myMembership = await db
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, actionMembershipKey),
          isNull(teamMemberships.endAt)
        )
      )
      .limit(1);

    if (!myMembership.length) return;

    const myRole = String(myMembership[0].role ?? "").trim().toLowerCase();
    const isManager = myRole === "manager" || myRole === "owner";

    if (isManager) {
      const otherManagers = await db
        .select({ steamId: teamMemberships.steamId })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.teamId, teamSlug),
            inArray(teamMemberships.role, ["manager", "owner"]),
            isNull(teamMemberships.endAt)
          )
        );

      const otherManagerCount = otherManagers.filter((row) => row.steamId !== actionMembershipKey).length;
      if (otherManagerCount === 0) {
        redirect("/teams?actionError=" + encodeURIComponent("Cannot leave team as the last manager. Promote another manager first."));
      }
    }

    const managerMembership = await db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamSlug),
          eq(teamMemberships.steamId, actionMembershipKey),
          inArray(teamMemberships.role, ["manager", "owner"]),
          isNull(teamMemberships.endAt)
        )
      )
      .limit(1);

    if (!managerMembership.length) return;

    await db
      .update(teamMemberships)
      .set({ endAt: new Date() })
      .where(and(eq(teamMemberships.teamId, teamSlug), isNull(teamMemberships.endAt)));

    revalidatePath("/teams");
    revalidatePath(`/teams/${teamSlug}`);
  }

  const teamRows = isAdmin
    ? (
        await db
          .select({
            teamId: teams.teamId,
            name: teams.name,
            slug: teams.slug,
            createdAt: teams.createdAt,
          })
          .from(teams)
          .orderBy(desc(teams.createdAt))
      ).map((team) => ({ ...team, viewerRole: "manager" as const }))
    : await db
        .select({
          teamId: teams.teamId,
          name: teams.name,
          slug: teams.slug,
          createdAt: teams.createdAt,
          viewerRole: teamMemberships.role,
        })
        .from(teams)
        .innerJoin(
          teamMemberships,
          and(
            eq(teamMemberships.teamId, teams.slug),
            eq(teamMemberships.steamId, membershipKey),
            isNull(teamMemberships.endAt)
          )
        )
        .orderBy(desc(teams.createdAt));

  const dedupedTeamRows = (() => {
    const bySlug = new Map<string, (typeof teamRows)[number]>();
    for (const team of teamRows) {
      const existing = bySlug.get(team.slug);
      if (!existing || roleRank(team.viewerRole) > roleRank(existing.viewerRole)) {
        bySlug.set(team.slug, team);
      }
    }
    return [...bySlug.values()];
  })();

  const managerTeamRows = dedupedTeamRows.filter((team) => isManagerRole(team.viewerRole));
  const teamSlugs = dedupedTeamRows.map((team) => team.slug);
  const selectedSearchTeamSlug = String(managerTeamRows[0]?.slug ?? "").trim();

  const databasePlayers = await db
    .select({
      steamId: players.steamId,
      displayName: players.displayName,
    })
    .from(players)
    .orderBy(desc(players.lastUpdated))
    .limit(1000);

  const rosterRows = teamSlugs.length
    ? await db
        .select({
          teamSlug: teamMemberships.teamId,
          steamId: teamMemberships.steamId,
          displayName: players.displayName,
          role: teamMemberships.role,
          startAt: teamMemberships.startAt,
        })
        .from(teamMemberships)
        .leftJoin(players, eq(players.steamId, teamMemberships.steamId))
        .where(
          and(
            isNull(teamMemberships.endAt),
            inArray(teamMemberships.role, ["manual", "player", "member", "manager", "owner"]),
            inArray(teamMemberships.teamId, teamSlugs)
          )
        )
    : [];

  const rosterByTeam = new Map<string, typeof rosterRows>();
  for (const row of rosterRows) {
    const list = rosterByTeam.get(row.teamSlug) ?? [];
    const existingIndex = list.findIndex((entry) => entry.steamId === row.steamId);

    if (existingIndex === -1) {
      list.push(row);
    } else {
      const existing = list[existingIndex];
      const existingTs = existing.startAt ? new Date(existing.startAt).getTime() : 0;
      const incomingTs = row.startAt ? new Date(row.startAt).getTime() : 0;
      if (incomingTs >= existingTs) {
        list[existingIndex] = row;
      }
    }

    rosterByTeam.set(row.teamSlug, list);
  }

  const teamMatchMembershipRows = teamSlugs.length
    ? await db
        .select({
          teamSlug: teamMemberships.teamId,
          matchId: matchPlayers.matchId,
        })
        .from(teamMemberships)
        .innerJoin(matchPlayers, eq(matchPlayers.steamId, teamMemberships.steamId))
        .innerJoin(matches, eq(matches.matchId, matchPlayers.matchId))
        .where(
          and(
            isNull(teamMemberships.endAt),
            inArray(teamMemberships.role, ["manual", "player", "member", "manager", "owner"]),
            inArray(teamMemberships.teamId, teamSlugs)
          )
        )
    : [];

  const teamMatchCounts = new Map<string, number>();
  const teamMatchSeen = new Set<string>();

  for (const row of teamMatchMembershipRows) {
    const key = `${row.teamSlug}:${row.matchId}`;
    if (teamMatchSeen.has(key)) continue;
    teamMatchSeen.add(key);
    teamMatchCounts.set(row.teamSlug, (teamMatchCounts.get(row.teamSlug) ?? 0) + 1);
  }

  const totalTeamMatches = [...teamMatchCounts.values()].reduce((sum, count) => sum + count, 0);

  const activeMembershipCount = rosterRows.length;

  const availableCompareTeams = dedupedTeamRows;
  const fallbackTeamA = availableCompareTeams[0]?.slug ?? "";
  const fallbackTeamB = availableCompareTeams.find((team) => team.slug !== fallbackTeamA)?.slug ?? fallbackTeamA;
  const compareTeamASlug =
    availableCompareTeams.some((team) => team.slug === compareTeamASlugRaw) ? compareTeamASlugRaw : fallbackTeamA;
  const compareTeamBSlug =
    availableCompareTeams.some((team) => team.slug === compareTeamBSlugRaw && team.slug !== compareTeamASlug)
      ? compareTeamBSlugRaw
      : availableCompareTeams.find((team) => team.slug !== compareTeamASlug)?.slug ?? compareTeamASlug;

  const compareTeamA = availableCompareTeams.find((team) => team.slug === compareTeamASlug) ?? null;
  const compareTeamB = availableCompareTeams.find((team) => team.slug === compareTeamBSlug) ?? null;

  function buildTeamSummary(teamSlug: string) {
    const roster = rosterByTeam.get(teamSlug) ?? [];
    const matchCount = teamMatchCounts.get(teamSlug) ?? 0;
    const managerCount = roster.filter((member) => isManagerRole(member.role)).length;
    const playerCount = roster.length;
    const matchesPerPlayer = playerCount > 0 ? matchCount / playerCount : 0;

    return {
      playerCount,
      managerCount,
      matchCount,
      matchesPerPlayer,
    };
  }

  const compareSummaryA = compareTeamA ? buildTeamSummary(compareTeamA.slug) : null;
  const compareSummaryB = compareTeamB ? buildTeamSummary(compareTeamB.slug) : null;

  function deltaClass(delta: number) {
    return delta >= 0 ? "text-emerald-300" : "text-rose-300";
  }

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <header className="panel-premium rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="heading-luxe text-3xl font-bold tracking-tight">Teams</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Manage manual team rosters and open team-level analytics.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href="/teams"
                className="inline-flex rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Update
              </a>
            </div>
          </div>

          <section className="panel-premium-soft w-full rounded-lg p-3">
            <h2 className="text-sm font-semibold text-zinc-200">Add team</h2>
            <form action={createTeamAction} className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input
                name="name"
                required
                placeholder="Team name"
                className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
              />
              <input
                name="slug"
                placeholder="Slug (optional)"
                className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
              >
                Add
              </button>
            </form>
            {teamErrorNotice ? <p className="mt-2 text-xs text-rose-300">{teamErrorNotice}</p> : null}
            {actionErrorNotice ? <p className="mt-2 text-xs text-rose-300">{actionErrorNotice}</p> : null}
          </section>

          <div className="flex flex-wrap gap-2 text-xs w-full md:w-auto">
            <span className="rounded border border-zinc-700 px-2 py-1 text-zinc-300">{dedupedTeamRows.length} teams</span>
            <span className="rounded border border-zinc-700 px-2 py-1 text-zinc-300">{activeMembershipCount} active players</span>
            <span className="rounded border border-zinc-700 px-2 py-1 text-zinc-300">{totalTeamMatches} matches</span>
          </div>
        </div>
      </header>

      <section className="panel-premium rounded-xl p-4">
        <details>
          <summary className="cursor-pointer list-none select-none text-sm font-semibold text-zinc-200">
            Roster tools (upload/search)
          </summary>
          <p className="mt-2 text-xs text-zinc-400">Choose a team, then bulk upload or search teammates.</p>
          {session && managerTeamRows.length ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <form action={uploadPlayersAction} className="space-y-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/20 p-3">
                <div>
                  <label className="mb-1 block text-sm text-zinc-300">Team</label>
                  <select
                    name="teamSlug"
                    required
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                    defaultValue={selectedSearchTeamSlug}
                  >
                    {managerTeamRows.map((team) => (
                      <option key={team.slug} value={team.slug}>
                        {team.name} ({team.slug})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-300">Players (one per line)</label>
                  <textarea
                    name="players"
                    required
                    rows={4}
                    placeholder={"76561198000000001, Player One\n76561198000000002, Player Two\n76561198000000003"}
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Format: <span className="font-mono">steamId</span> or <span className="font-mono">steamId, displayName</span>.
                  </p>
                </div>
                <button
                  type="submit"
                  className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
                >
                  Upload roster
                </button>
              </form>

              <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/20 p-3">
                <h3 className="text-sm font-semibold text-zinc-200">Search player from database</h3>
                {databasePlayers.length ? (
                  <TeamPlayerSearch
                    teams={managerTeamRows.map((team) => ({ slug: team.slug, name: team.name }))}
                    players={databasePlayers.map((player) => ({
                      steamId: player.steamId,
                      displayName: player.displayName,
                    }))}
                    defaultTeamSlug={selectedSearchTeamSlug}
                    addPlayerAction={addPlayerFromDatabaseAction}
                  />
                ) : (
                  <p className="mt-2 text-sm text-zinc-400">No players in database yet. Ingest matches first.</p>
                )}
              </div>

              <form action={createInviteCodeAction} className="space-y-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/20 p-3">
                <h3 className="text-sm font-semibold text-zinc-200">Generate invite code</h3>
                <div>
                  <label className="mb-1 block text-sm text-zinc-300">Team</label>
                  <select
                    name="teamSlug"
                    required
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                    defaultValue={selectedSearchTeamSlug}
                  >
                    {managerTeamRows.map((team) => (
                      <option key={`invite-${team.slug}`} value={team.slug}>
                        {team.name} ({team.slug})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    name="maxUses"
                    type="number"
                    min={1}
                    defaultValue={25}
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  />
                  <input
                    name="days"
                    type="number"
                    min={1}
                    defaultValue={30}
                    className="w-full rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
                >
                  Generate invite code
                </button>
                {inviteCodeNotice ? (
                  <p className="text-xs text-emerald-300">Invite code for {inviteTeamNotice || "team"}: {inviteCodeNotice}</p>
                ) : null}
                {inviteErrorNotice ? <p className="text-xs text-rose-300">{inviteErrorNotice}</p> : null}
              </form>
            </div>
          ) : !session ? (
            <p className="text-sm text-zinc-400">Sign in to upload or edit rosters.</p>
          ) : dedupedTeamRows.length ? (
            <p className="text-sm text-zinc-400">Manager role is required to edit rosters.</p>
          ) : (
            <p className="text-sm text-zinc-400">Create a team first, then upload players.</p>
          )}
        </details>
      </section>

      <section className="panel-premium rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-3">Current teams</h2>
        <p className="mb-3 text-sm text-zinc-400">Roster preview for active manually added players.</p>

        {dedupedTeamRows.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {dedupedTeamRows.map((team) => {
              const roster = rosterByTeam.get(team.slug) ?? [];
              return (
                <article key={team.slug} className="panel-premium-soft relative rounded-lg p-3 sm:p-4 transition-all duration-150 hover:border-zinc-700/90 hover:shadow-sm">
                  <a
                    href={`/teams/${team.slug}`}
                    aria-label={`Open ${team.name} team stats`}
                    className="absolute inset-0 z-0 rounded-lg"
                  />
                  <div className="relative z-10 flex items-center justify-between gap-3 pointer-events-none">
                    <div className="min-w-0 flex-1 px-1 py-1">
                      <h3 className="font-semibold">{team.name}</h3>
                      <p className="text-xs text-zinc-500">{team.slug}</p>
                      <p className="text-xs text-zinc-500">Role: {team.viewerRole ?? "player"}</p>
                      <span className="mt-1 inline-block text-xs text-emerald-300">Open stats →</span>
                    </div>
                    <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                      {roster.length} players
                    </span>
                  </div>

                  <div className="relative z-20 mt-2 flex flex-wrap gap-2">
                    <form action={leaveTeamAction}>
                      <input type="hidden" name="teamSlug" value={team.slug} />
                      <button
                        type="submit"
                        className="rounded border border-zinc-600/80 bg-zinc-900/70 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        Leave team
                      </button>
                    </form>
                    {isManagerRole(team.viewerRole) ? (
                      <form action={deleteTeamAction} className="flex w-full sm:w-auto items-center gap-2">
                        <input type="hidden" name="teamSlug" value={team.slug} />
                        <input
                          type="text"
                          name="confirmText"
                          placeholder="Type DELETE"
                          className="w-full sm:w-28 rounded border border-zinc-700/80 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-200"
                        />
                        <button
                          type="submit"
                          className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                        >
                          Delete team
                        </button>
                      </form>
                    ) : null}
                  </div>

                  <div className="relative z-10 mt-3 space-y-2">
                    {roster.length ? (
                      roster.slice(0, 10).map((member) => (
                        <div
                          key={`${team.slug}-${member.steamId}`}
                          className="relative flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-2 text-sm hover:bg-zinc-900/65 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <a
                            href={`/players/${member.steamId}`}
                            aria-label={`Open player profile for ${member.displayName ?? member.steamId}`}
                            className="absolute inset-0 z-0 rounded"
                          />
                          <div className="relative z-10 min-w-0 sm:flex-1">
                            <span className="truncate block">{member.displayName ?? "(unknown)"}</span>
                            <span className="font-mono text-xs text-zinc-500">{member.steamId}</span>
                            <span className="block text-[11px] text-zinc-500">Role: {memberRoleLabel(member.role)}</span>
                          </div>
                          {isManagerRole(team.viewerRole) ? (
                            <div className="relative z-20 ml-0 flex w-full flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto sm:flex-nowrap">
                              <form action={changeMemberRoleAction} className="w-full sm:w-auto">
                                <input type="hidden" name="teamSlug" value={team.slug} />
                                <input type="hidden" name="playerSteamId" value={member.steamId} />
                                <input
                                  type="hidden"
                                  name="nextRole"
                                  value={normalizeMemberRole(member.role) === "manager" ? "player" : "manager"}
                                />
                                <button
                                  type="submit"
                                  className="inline-flex h-7 w-full sm:w-auto min-w-27 items-center justify-center rounded border border-zinc-600/80 bg-zinc-900/70 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                                >
                                  {normalizeMemberRole(member.role) === "manager" ? "Make player" : "Make manager"}
                                </button>
                              </form>

                              {memberRoleLabel(member.role) !== "owner" ? (
                                <form action={transferOwnerAction} className="w-full sm:w-auto">
                                  <input type="hidden" name="teamSlug" value={team.slug} />
                                  <input type="hidden" name="playerSteamId" value={member.steamId} />
                                  <button
                                    type="submit"
                                    className="inline-flex h-7 w-full sm:w-auto min-w-27 items-center justify-center rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/20"
                                  >
                                    Transfer owner
                                  </button>
                                </form>
                              ) : null}

                              <form action={removePlayerFromTeamAction} className="w-full sm:w-auto">
                                <input type="hidden" name="teamSlug" value={team.slug} />
                                <input type="hidden" name="playerSteamId" value={member.steamId} />
                                <button
                                  type="submit"
                                  className="inline-flex h-7 w-full sm:w-auto min-w-21 items-center justify-center rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                                >
                                  Remove
                                </button>
                              </form>
                            </div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-400">No active players yet.</p>
                    )}
                    {roster.length > 10 ? (
                      <p className="text-xs text-zinc-500">+{roster.length - 10} more players</p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">No teams yet. Create your first team above.</p>
        )}
      </section>

    </main>
  );
}
