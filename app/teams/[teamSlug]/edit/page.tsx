import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import BackButton from "../../../../components/BackButton";
import { db, pool } from "../../../../lib";
import { authOptions } from "../../../../lib/auth";
import { players, teamMemberships, teams } from "../../../../db/schema";

function extractMembershipKey(session: { user?: { id?: string } } | null) {
  const rawUserId = String(session?.user?.id ?? "").trim();
  if (!rawUserId) return "";
  if (rawUserId.startsWith("steam:")) return rawUserId.slice(6).trim();
  if (rawUserId.startsWith("user:")) return rawUserId.slice(5).trim();
  if (rawUserId.includes(":")) return "";
  return rawUserId;
}

function isAdminSession(session: { user?: { email?: string | null; isAdmin?: boolean } } | null) {
  if (Boolean(session?.user?.isAdmin)) return true;
  const adminEmail = String(process.env.AUTH_EMAIL ?? "").trim().toLowerCase();
  const tempAdminEmail = String(process.env.TEMP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const sessionEmail = String(session?.user?.email ?? "").trim().toLowerCase();
  return Boolean(sessionEmail) && (sessionEmail === adminEmail || sessionEmail === tempAdminEmail);
}

function roleRank(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "owner") return 3;
  if (normalized === "manager") return 2;
  return 1;
}

function allowedRole(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "owner") return "owner";
  if (normalized === "manager") return "manager";
  return "player";
}

async function getManageContext(teamSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false as const, reason: "signin" };

  const admin = isAdminSession(session as { user?: { email?: string | null; isAdmin?: boolean } } | null);
  const membershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);

  const teamRows = await db
    .select({
      teamId: teams.teamId,
      slug: teams.slug,
      name: teams.name,
    })
    .from(teams)
    .where(eq(teams.slug, teamSlug))
    .limit(1);

  if (!teamRows.length) return { ok: false as const, reason: "missing" };

  if (admin) {
    return {
      ok: true as const,
      admin,
      session,
      membershipKey,
      team: teamRows[0],
      role: "owner",
    };
  }

  if (!membershipKey) return { ok: false as const, reason: "forbidden" };

  const teamIdText = String(teamRows[0].teamId);

  const membershipRows = await db
    .select({ role: teamMemberships.role })
    .from(teamMemberships)
    .where(
      and(
        sql`(${teamMemberships.teamId} = ${teamSlug} OR ${teamMemberships.teamId} = ${teamIdText})`,
        eq(teamMemberships.steamId, membershipKey),
        isNull(teamMemberships.endAt)
      )
    )
    .limit(1);

  if (!membershipRows.length) return { ok: false as const, reason: "forbidden" };

  const role = allowedRole(membershipRows[0]?.role);
  if (roleRank(role) < roleRank("manager")) return { ok: false as const, reason: "forbidden" };

  return {
    ok: true as const,
    admin,
    session,
    membershipKey,
    team: teamRows[0],
    role,
  };
}

function makeInviteCode() {
  return `INV-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function hashInvite(code: string) {
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

function appOrigin() {
  const explicit = String(process.env.NEXTAUTH_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = String(process.env.VERCEL_URL ?? "").trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/$/, "")}`;
  return "";
}

function normalizeEnemyTeamName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 64);
}

function enemyTeamKey(value: string) {
  return value.toLowerCase();
}

let enemyTeamsTableReady = false;

async function ensureEnemyTeamsTable() {
  if (enemyTeamsTableReady) return;

  await pool.query(
    `CREATE TABLE IF NOT EXISTS team_enemy_teams (
      enemy_id BIGSERIAL PRIMARY KEY,
      team_slug TEXT NOT NULL,
      enemy_name TEXT NOT NULL,
      enemy_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  );

  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS team_enemy_teams_key_unique
     ON team_enemy_teams (team_slug, enemy_key)`
  );

  await pool.query(
    `CREATE INDEX IF NOT EXISTS team_enemy_teams_slug_idx
     ON team_enemy_teams (team_slug, created_at DESC)`
  );

  enemyTeamsTableReady = true;
}

export default async function TeamEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamSlug: string }>;
  searchParams?: Promise<{ notice?: string; error?: string; invite?: string }>;
}) {
  const { teamSlug } = await params;
  const qs = searchParams ? await searchParams : undefined;
  const notice = String(qs?.notice ?? "").trim();
  const error = String(qs?.error ?? "").trim();
  const inviteCode = String(qs?.invite ?? "").trim();

  const context = await getManageContext(teamSlug);
  if (!context.ok) {
    const title = context.reason === "signin" ? "Sign in required" : context.reason === "missing" ? "Team not found" : "Forbidden";
    const detail =
      context.reason === "signin"
        ? "Sign in to manage this team."
        : context.reason === "missing"
          ? `No team exists for slug ${teamSlug}.`
          : "You need manager or owner access to edit this team.";

    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4">
        <BackButton />
        <section className="panel-premium rounded-xl p-5">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-zinc-400">{detail}</p>
        </section>
      </main>
    );
  }

  const team = context.team;

  async function addOrInviteMemberAction(formData: FormData) {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    const steamId = String(formData.get("steamId") ?? "").trim();
    const role = allowedRole(String(formData.get("role") ?? "player"));

    if (!steamId) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Steam ID is required.")}`);
    }

    await pool.query(
      `
      WITH active AS (
        SELECT 1
        FROM team_memberships
        WHERE team_id = $1 AND steam_id = $2 AND end_at IS NULL
        LIMIT 1
      )
      INSERT INTO team_memberships (team_id, steam_id, role, start_at)
      SELECT $1, $2, $3, now()
      WHERE NOT EXISTS (SELECT 1 FROM active)
      `,
      [teamSlug, steamId, role]
    );

    await pool.query(
      `
      UPDATE team_memberships
      SET role = $3
      WHERE team_id = $1 AND steam_id = $2 AND end_at IS NULL
      `,
      [teamSlug, steamId, role]
    );

    revalidatePath(`/teams/${teamSlug}`);
    revalidatePath(`/teams/${teamSlug}/edit`);
    revalidatePath("/teams");
    redirect(`/teams/${teamSlug}/edit?notice=${encodeURIComponent("Roster updated.")}`);
  }

  async function updateMemberRoleAction(formData: FormData) {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    const steamId = String(formData.get("steamId") ?? "").trim();
    const role = allowedRole(String(formData.get("role") ?? "player"));

    if (!steamId) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Steam ID is required.")}`);
    }

    await pool.query(
      `
      UPDATE team_memberships
      SET role = $3
      WHERE team_id = $1 AND steam_id = $2 AND end_at IS NULL
      `,
      [teamSlug, steamId, role]
    );

    revalidatePath(`/teams/${teamSlug}`);
    revalidatePath(`/teams/${teamSlug}/edit`);
    redirect(`/teams/${teamSlug}/edit?notice=${encodeURIComponent("Member role updated.")}`);
  }

  async function removeMemberAction(formData: FormData) {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    const steamId = String(formData.get("steamId") ?? "").trim();
    if (!steamId) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Steam ID is required.")}`);
    }

    await pool.query(
      `
      UPDATE team_memberships
      SET end_at = now()
      WHERE team_id = $1 AND steam_id = $2 AND end_at IS NULL
      `,
      [teamSlug, steamId]
    );

    revalidatePath(`/teams/${teamSlug}`);
    revalidatePath(`/teams/${teamSlug}/edit`);
    revalidatePath("/teams");
    redirect(`/teams/${teamSlug}/edit?notice=${encodeURIComponent("Member removed from active roster.")}`);
  }

  async function createPermanentInviteAction() {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    let createdCode = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const nextCode = makeInviteCode();
      const codeHash = hashInvite(nextCode);
      try {
        await pool.query(
          `
          INSERT INTO invite_codes (code_hash, team_id, expires_at, max_uses, uses, note)
          VALUES ($1, $2, NULL, 1000000, 0, $3)
          `,
          [codeHash, fresh.team.teamId, `Permanent team invite for ${fresh.team.slug}`]
        );
        createdCode = nextCode;
        break;
      } catch {
        // retry on hash collision
      }
    }

    if (!createdCode) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Could not create invite code. Please try again.")}`);
    }

    revalidatePath(`/teams/${teamSlug}/edit`);
    redirect(`/teams/${teamSlug}/edit?invite=${encodeURIComponent(createdCode)}&notice=${encodeURIComponent("Permanent invite link created.")}`);
  }

  async function addEnemyTeamAction(formData: FormData) {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    const enemyName = normalizeEnemyTeamName(formData.get("enemyName"));
    if (!enemyName) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Enemy team name is required.")}`);
    }

    await ensureEnemyTeamsTable();

    await pool.query(
      `INSERT INTO team_enemy_teams (team_slug, enemy_name, enemy_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_slug, enemy_key)
       DO UPDATE SET enemy_name = EXCLUDED.enemy_name`,
      [teamSlug, enemyName, enemyTeamKey(enemyName)]
    );

    revalidatePath(`/teams/${teamSlug}/edit`);
    revalidatePath(`/scrims`);
    redirect(`/teams/${teamSlug}/edit?notice=${encodeURIComponent("Enemy team saved.")}`);
  }

  async function removeEnemyTeamAction(formData: FormData) {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    const enemyName = normalizeEnemyTeamName(formData.get("enemyName"));
    if (!enemyName) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Enemy team name is required.")}`);
    }

    await ensureEnemyTeamsTable();

    await pool.query(
      `DELETE FROM team_enemy_teams
       WHERE team_slug = $1 AND enemy_key = $2`,
      [teamSlug, enemyTeamKey(enemyName)]
    );

    revalidatePath(`/teams/${teamSlug}/edit`);
    revalidatePath(`/scrims`);
    redirect(`/teams/${teamSlug}/edit?notice=${encodeURIComponent("Enemy team removed.")}`);
  }

  async function deleteTeamAction(formData: FormData) {
    "use server";

    const fresh = await getManageContext(teamSlug);
    if (!fresh.ok) redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("You no longer have access to edit this team.")}`);

    const confirmSlug = String(formData.get("confirmSlug") ?? "").trim();
    if (confirmSlug !== teamSlug) {
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Type the exact team slug to delete.")}`);
    }

    await ensureEnemyTeamsTable();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM invite_codes WHERE team_id = $1`, [fresh.team.teamId]);
      await client.query(`DELETE FROM team_enemy_teams WHERE team_slug = $1`, [teamSlug]);
      await client.query(`UPDATE team_memberships SET end_at = now() WHERE team_id = $1 AND end_at IS NULL`, [teamSlug]);
      await client.query(`DELETE FROM teams WHERE slug = $1`, [teamSlug]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
      redirect(`/teams/${teamSlug}/edit?error=${encodeURIComponent("Could not delete team.")}`);
    } finally {
      client.release();
    }

    revalidatePath("/teams");
    redirect(`/teams?teamError=${encodeURIComponent("Team deleted.")}`);
  }

  const rosterRows = await db
    .select({
      steamId: teamMemberships.steamId,
      role: teamMemberships.role,
      startAt: teamMemberships.startAt,
      displayName: players.displayName,
    })
    .from(teamMemberships)
    .leftJoin(players, eq(players.steamId, teamMemberships.steamId))
    .where(and(eq(teamMemberships.teamId, teamSlug), isNull(teamMemberships.endAt)));

  const sortedRoster = [...rosterRows].sort((a, b) => {
    const roleDiff = roleRank(b.role) - roleRank(a.role);
    if (roleDiff !== 0) return roleDiff;
    const nameA = String(a.displayName ?? a.steamId);
    const nameB = String(b.displayName ?? b.steamId);
    return nameA.localeCompare(nameB);
  });

  await ensureEnemyTeamsTable();
  const enemyTeamRows = await pool.query(
    `SELECT enemy_name
     FROM team_enemy_teams
     WHERE team_slug = $1
     ORDER BY created_at DESC, enemy_name ASC`,
    [teamSlug]
  );
  const namedEnemyTeams = enemyTeamRows.rows
    .map((row) => normalizeEnemyTeamName(row.enemy_name))
    .filter((name, index, source) => Boolean(name) && source.indexOf(name) === index);

  const origin = appOrigin();
  const inviteLink = inviteCode ? `${origin || ""}/join?code=${encodeURIComponent(inviteCode)}` : "";

  return (
    <main id="main-content" className="w-full">
      <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 pt-6 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between gap-3">
          <BackButton />
          <Link href={`/teams/${teamSlug}`} className="text-sm text-zinc-300 hover:underline">
            Back to team stats
          </Link>
        </div>

        <header className="panel-premium rounded-xl p-4 md:p-5">
          <h1 className="text-3xl font-bold tracking-tight">Edit {team.name}</h1>
          <p className="mt-1.5 text-sm text-zinc-400">Manage roster, invites, and team settings.</p>
        </header>

        {notice ? (
          <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </section>
        ) : null}

        {error ? (
          <section className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </section>
        ) : null}

        <div dir="ltr" data-orientation="horizontal" data-slot="tabs" className="flex flex-col gap-2 space-y-4">
          <div
            role="tablist"
            aria-orientation="horizontal"
            data-slot="tabs-list"
            className="team-edit-tabs-list inline-flex h-9 w-full items-center rounded-lg p-0.75 md:w-fit"
          >
            <a role="tab" aria-selected="true" data-state="active" href="#overview" className="team-edit-tab-trigger">Overview</a>
            <a role="tab" aria-selected="false" data-state="inactive" href="#roster" className="team-edit-tab-trigger">Roster</a>
            <a role="tab" aria-selected="false" data-state="inactive" href="#enemy-teams" className="team-edit-tab-trigger">Enemy Teams</a>
            <a role="tab" aria-selected="false" data-state="inactive" href="#invites" className="team-edit-tab-trigger">Invites</a>
            <a role="tab" aria-selected="false" data-state="inactive" href="#danger" className="team-edit-tab-trigger">Danger Zone</a>
          </div>

          <div
            data-state="active"
            data-orientation="horizontal"
            role="tabpanel"
            tabIndex={0}
            data-slot="tabs-content"
            className="flex-1 space-y-4 outline-none"
          >
      <section id="overview" data-slot="card" data-size="default" className="team-edit-card panel-premium rounded-xl p-4 md:p-5 space-y-3">
        <h2 className="text-base leading-normal font-medium">Quick overview</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3">
            <p className="text-xs text-zinc-400">Team</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{team.name}</p>
          </div>
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3">
            <p className="text-xs text-zinc-400">Slug</p>
            <p className="mt-1 font-mono text-sm text-zinc-200">{teamSlug}</p>
          </div>
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3">
            <p className="text-xs text-zinc-400">Active members</p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">{sortedRoster.length}</p>
          </div>
        </div>
      </section>

      <section id="roster" data-slot="card" data-size="default" className="team-edit-card panel-premium rounded-xl p-4 md:p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Roster editor</h2>
          <p className="text-sm text-zinc-400">Invite by Steam ID or update/remove active members.</p>
        </div>

        <form action={addOrInviteMemberAction} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
          <input
            name="steamId"
            required
            placeholder="Steam ID"
            className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <select name="role" defaultValue="player" className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm">
            <option value="player">Player</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
          <button
            type="submit"
            className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
          >
            Invite / Add
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/70">
              <tr>
                <th className="p-3 text-left">Member</th>
                <th className="p-3 text-left">Steam ID</th>
                <th className="p-3 text-left">Role</th>
                <th className="p-3 text-left">Started</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRoster.map((member) => (
                <tr key={`member-${member.steamId}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                  <td className="p-3">{member.displayName ?? "(unknown)"}</td>
                  <td className="p-3 font-mono text-xs">{member.steamId}</td>
                  <td className="p-3">
                    <form action={updateMemberRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="steamId" value={member.steamId} />
                      <select
                        name="role"
                        defaultValue={allowedRole(member.role)}
                        className="rounded border border-zinc-700/80 bg-zinc-900/90 px-2 py-1 text-xs"
                      >
                        <option value="player">Player</option>
                        <option value="manager">Manager</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded border border-zinc-700/80 bg-zinc-900/80 px-2 py-1 text-xs hover:bg-zinc-800"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                  <td className="p-3 text-xs text-zinc-400">
                    {member.startAt ? new Date(member.startAt).toLocaleString() : "-"}
                  </td>
                  <td className="p-3">
                    <form action={removeMemberAction}>
                      <input type="hidden" name="steamId" value={member.steamId} />
                      <button
                        type="submit"
                        className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="enemy-teams" data-slot="card" data-size="default" className="team-edit-card panel-premium rounded-xl p-4 md:p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Named enemy teams</h2>
          <p className="text-sm text-zinc-400">Manage opponent names that can be assigned when creating or editing a scrim.</p>
        </div>

        <form action={addEnemyTeamAction} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            name="enemyName"
            required
            maxLength={64}
            placeholder="Enemy team name"
            className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
          >
            Save enemy
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-zinc-800/70">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/70">
              <tr>
                <th className="p-3 text-left">Enemy team name</th>
                <th className="p-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {namedEnemyTeams.length ? (
                namedEnemyTeams.map((enemyName) => (
                  <tr key={`enemy-${enemyName}`} className="border-t border-zinc-800/80 odd:bg-zinc-900/20">
                    <td className="p-3">{enemyName}</td>
                    <td className="p-3">
                      <form action={removeEnemyTeamAction}>
                        <input type="hidden" name="enemyName" value={enemyName} />
                        <button
                          type="submit"
                          className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/20"
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="p-3 text-zinc-400" colSpan={2}>No named enemy teams yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="invites" data-slot="card" data-size="default" className="team-edit-card panel-premium rounded-xl p-4 md:p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Permanent invite link</h2>
          <p className="text-sm text-zinc-400">Generate a long-lived reusable invite code for this team.</p>
        </div>

        <form action={createPermanentInviteAction}>
          <button
            type="submit"
            className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
          >
            Create permanent invite
          </button>
        </form>

        {inviteCode ? (
          <div className="rounded-lg border border-zinc-700/80 bg-zinc-900/70 p-3 text-sm space-y-2">
            <p>
              Invite code: <span className="font-mono">{inviteCode}</span>
            </p>
            <p className="break-all">
              Invite link: <span className="font-mono">{inviteLink || `/join?code=${inviteCode}`}</span>
            </p>
          </div>
        ) : null}
      </section>

      <section id="danger" data-slot="card" data-size="default" className="team-edit-card panel-premium rounded-xl border border-rose-600/40 p-4 md:p-5 space-y-3">
        <h2 className="text-lg font-semibold text-rose-200">Delete team</h2>
        <p className="text-sm text-zinc-400">
          This ends active memberships and removes the team. Type <span className="font-mono">{teamSlug}</span> to confirm.
        </p>

        <form action={deleteTeamAction} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            name="confirmSlug"
            required
            placeholder={`Type ${teamSlug}`}
            className="rounded border border-rose-500/40 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded border border-rose-500/40 bg-rose-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
          >
            Delete team
          </button>
        </form>
      </section>
          </div>
        </div>
      </div>
      </div>
    </main>
  );
}
