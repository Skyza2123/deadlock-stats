export const THEME_STORAGE_KEY = "deadlock-theme";
export const MODE_STORAGE_KEY = "deadlock-mode";

export type ModeOption = "dark" | "light";
export type PaletteOption = "green" | "red" | "blue" | "mono";

export const DEFAULT_MODE: ModeOption = "dark";
export const DEFAULT_PALETTE: PaletteOption = "mono";

export const PALETTE_LABELS: Record<PaletteOption, string> = {
  green: "Green",
  red: "Red",
  blue: "Blue",
  mono: "Default",
};

export function composeThemeId(palette: PaletteOption, mode: ModeOption) {
  return `${palette}-${mode}`;
}

export function isValidThemeId(value: string | null): value is `${PaletteOption}-${ModeOption}` {
  if (!value) return false;
  return /^(green|red|blue|mono)-(dark|light)$/.test(value);
}

function legacyThemeToCurrent(theme: string): { palette: PaletteOption; mode: ModeOption } | null {
  switch (theme) {
    case "obsidian":
      return { palette: "mono", mode: "dark" };
    case "graphite":
      return { palette: "blue", mode: "dark" };
    case "ember":
      return { palette: "red", mode: "dark" };
    case "verdant":
      return { palette: "green", mode: "dark" };
    case "dawn":
      return { palette: "red", mode: "light" };
    case "paper":
      return { palette: "mono", mode: "light" };
    case "arctic":
      return { palette: "blue", mode: "light" };
    case "sage":
      return { palette: "green", mode: "light" };
    default:
      return null;
  }
}

export function normalizeStoredTheme(
  storedTheme: string | null,
  storedMode: string | null
): { palette: PaletteOption; mode: ModeOption; themeId: string } {
  if (isValidThemeId(storedTheme)) {
    const [palette, mode] = storedTheme.split("-") as [PaletteOption, ModeOption];
    return { palette, mode, themeId: storedTheme };
  }

  const legacy = storedTheme ? legacyThemeToCurrent(storedTheme) : null;
  if (legacy) {
    return { palette: legacy.palette, mode: legacy.mode, themeId: composeThemeId(legacy.palette, legacy.mode) };
  }

  const mode: ModeOption = storedMode === "light" ? "light" : DEFAULT_MODE;
  const palette = DEFAULT_PALETTE;
  return { palette, mode, themeId: composeThemeId(palette, mode) };
}
