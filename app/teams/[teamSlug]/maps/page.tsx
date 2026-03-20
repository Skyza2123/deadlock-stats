import TeamStatsPage from "../page";

export default async function TeamStatsMapsPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamSlug: string }>;
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  return TeamStatsPage({
    params,
    searchParams: Promise.resolve({
      from: resolved?.from,
      to: resolved?.to,
      section: "maps",
    }),
  });
}
