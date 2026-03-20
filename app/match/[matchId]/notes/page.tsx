import BackButton from "@/components/BackButton";
import MatchNotesPageClient from "@/components/MatchNotesPageClient";

export default async function MatchNotesPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
      <BackButton />
      <MatchNotesPageClient matchId={matchId} basePath={`/match/${matchId}`} />
    </main>
  );
}