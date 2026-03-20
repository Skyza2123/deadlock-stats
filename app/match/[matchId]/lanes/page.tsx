import BackButton from "../../../../components/BackButton";
import MatchLanesView from "../../../../components/MatchLanesView";
import MatchTabsNav from "../../../../components/MatchTabsNav";
import { loadMatchLanesData } from "../../../../lib/matchLanesData";

export default async function MatchLanesPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const data = await loadMatchLanesData(matchId);

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
      <BackButton />
      <MatchTabsNav matchId={matchId} active="lanes" />
      <MatchLanesView matchId={matchId} laneSummary={data.laneSummary} />
    </main>
  );
}
