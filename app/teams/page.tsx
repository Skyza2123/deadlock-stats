import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { db } from "../../db";
import { teamMemberships, teams } from "../../db/schema";
import { authOptions } from "../../lib/auth";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

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

export default async function TeamsPage({
  searchParams,
}: {
  searchParams?: Promise<{ teamError?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const isAdmin = isAdminSession(session as { user?: { email?: string | null; isAdmin?: boolean } } | null);

  if (!session) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
        <section className="panel-premium rounded-xl p-4 md:p-5">
          <h1 className="text-2xl font-bold">Sign in required</h1>
          <p className="mt-2 text-zinc-400">Team data is hidden until you sign in.</p>
          <a
            href="/login"
            className="mt-4 inline-block rounded border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm hover:bg-zinc-800"
          >
            Go to login
          </a>
        </section>
      </main>
    );
  }

  const membershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
  if (!isAdmin && !membershipKey) {
    return (
      <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
        <section className="panel-premium rounded-xl p-4 md:p-5">
          <h1 className="text-2xl font-bold">Invalid session</h1>
          <p className="mt-2 text-zinc-400">Could not resolve your user identity for team access.</p>
        </section>
      </main>
    );
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const teamErrorNotice = String(resolvedSearchParams?.teamError ?? "").trim();

  async function createTeamAction(formData: FormData) {
    "use server";

    const session = await getServerSession(authOptions);
    if (!session) return;

    const actionIsAdmin = isAdminSession(session as { user?: { email?: string | null; isAdmin?: boolean } } | null);
    const actionMembershipKey = extractMembershipKey(session as { user?: { id?: string } } | null);
    if (!actionIsAdmin && !actionMembershipKey) return;

    const name = String(formData.get("name") ?? "").trim();
    const slugInput = String(formData.get("slug") ?? "").trim();
    if (!name) return;

    const slug = slugify(slugInput || name);
    if (!slug) {
      redirect("/teams?teamError=" + encodeURIComponent("Invalid team name."));
    }

    const existingByName = await db
      .select({ slug: teams.slug })
      .from(teams)
      .where(sql`lower(${teams.name}) = lower(${name})`)
      .limit(1);

    if (existingByName.length) {
      redirect("/teams?teamError=" + encodeURIComponent("A team with this name already exists."));
    }

    const existingBySlug = await db
      .select({ slug: teams.slug })
      .from(teams)
      .where(eq(teams.slug, slug))
      .limit(1);

    if (existingBySlug.length) {
      redirect("/teams?teamError=" + encodeURIComponent("That team slug is already in use."));
    }

    await db.insert(teams).values({ name, slug });

    revalidatePath("/teams");
    redirect("/teams");
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
            sql`(${teamMemberships.teamId} = ${teams.slug} OR ${teamMemberships.teamId} = ${teams.teamId}::text)`,
            eq(teamMemberships.steamId, membershipKey),
            isNull(teamMemberships.endAt)
          )
        )
        .orderBy(desc(teams.createdAt));

  const visibleTeams = (() => {
    const bySlug = new Map<string, (typeof teamRows)[number]>();
    for (const team of teamRows) {
      const existing = bySlug.get(team.slug);
      if (!existing || roleRank(team.viewerRole) > roleRank(existing.viewerRole)) {
        bySlug.set(team.slug, team);
      }
    }
    return [...bySlug.values()];
  })();

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Teams</h1>

      <section className="panel-premium rounded-xl p-4 md:p-5 space-y-4">
        <form action={createTeamAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            name="name"
            required
            placeholder="Team name"
            className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <input
            name="slug"
            placeholder="Slug (optional)"
            className="rounded border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded border border-emerald-500/40 bg-emerald-700/90 px-4 py-2 text-sm font-medium hover:bg-emerald-600"
          >
            Create Team
          </button>
        </form>
        {teamErrorNotice ? <p className="text-xs text-rose-300">{teamErrorNotice}</p> : null}

        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/35 p-3 min-h-70">
          {visibleTeams.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {visibleTeams.map((team) => (
                <article
                  key={team.slug}
                  className="group relative rounded-xl border border-zinc-800/80 bg-zinc-900/45 p-4 transition-all hover:border-zinc-600/90 hover:bg-zinc-900/65"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold leading-snug wrap-break-word">{team.name}</h3>
                      <div className="h-10 w-10 shrink-0 rounded-full bg-linear-to-br from-yellow-400 to-emerald-400" />
                    </div>

                    <div className="space-y-1 text-xs text-zinc-400">
                      <p>{team.slug}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={`/teams/${team.slug}`}
                        className="inline-flex items-center gap-1 text-xs text-zinc-200 hover:text-zinc-100"
                      >
                        View stats →
                      </a>
                      <a
                        href={`/teams/${team.slug}/edit`}
                        className="inline-flex items-center gap-1 rounded border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        Edit team
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">No teams yet. Create your first team above.</p>
          )}
        </div>
      </section>
    </main>
  );
}
