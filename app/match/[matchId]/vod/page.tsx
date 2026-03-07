import BackButton from "../../../../components/BackButton";
import MatchExperienceTabs from "../../../../components/MatchExperienceTabs";
import { loadMatchExperienceData } from "../../../../lib/matchExperienceData";

export default async function MatchVodPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const data = await loadMatchExperienceData(matchId);

  return (
    <main className="w-full p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
      <BackButton />
      <MatchExperienceTabs activeTab="vod" basePath={`/match/${matchId}`} {...data} />
    </main>
  );
}
