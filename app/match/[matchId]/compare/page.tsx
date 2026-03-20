import BackButton from "../../../../components/BackButton";
import MatchTabsNav from "../../../../components/MatchTabsNav";
import MatchCompareView from "../../../../components/MatchCompareView";
import { loadMatchCompareData } from "../../../../lib/matchCompareData";

export default async function MatchComparePage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const data = await loadMatchCompareData(matchId);

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
      <BackButton />
      <MatchTabsNav matchId={matchId} active="compare" />
      <MatchCompareView matchId={matchId} players={data.players} />
    </main>
  );
}
