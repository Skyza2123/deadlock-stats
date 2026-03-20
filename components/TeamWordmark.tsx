type TeamSide = "0" | "1" | string | null;

const TEAM_NAMES: Record<string, string> = {
  "0": "Hidden King",
  "1": "Archmother",
};

const TEAM_LOGO_PATHS: Record<string, string> = {
  "0": "/assets/logos/hidden-king-logo.png",
  "1": "/assets/logos/archmother-logo.png",
};

const TEAM_LOGO_COLORS: Record<string, string> = {
  "0": "#eab308",
  "1": "#60a5fa",
};

type TeamWordmarkProps = {
  side: TeamSide;
  className?: string;
};

export default function TeamWordmark({ side, className }: TeamWordmarkProps) {
  if (side == null) return null;

  const src = TEAM_LOGO_PATHS[side];
  if (!src) return null;

  return (
    <div
      role="img"
      aria-label={`${TEAM_NAMES[side] ?? side} logo`}
      className={className}
      style={{
        backgroundColor: TEAM_LOGO_COLORS[side] ?? "#ffffff",
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "left center",
        maskPosition: "left center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}