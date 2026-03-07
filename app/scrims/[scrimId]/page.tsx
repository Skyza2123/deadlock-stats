import ScrimDetailView from "@/components/ScrimDetailView";

export default async function ScrimPage({
  params,
}: {
  params: Promise<{ scrimId: string }>;
}) {
  const { scrimId } = await params;

  return <ScrimDetailView scrimId={scrimId} />;
}
