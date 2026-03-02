import fs from "node:fs";
import path from "node:path";

const REQUIRED_VARS = [
  "DATABASE_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "STEAM_SECRET",
  "DEADLOCK_API_KEY",
];

function parseArgs(argv) {
  const args = {
    file: ".env.local",
    prod: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--prod") {
      args.prod = true;
      continue;
    }

    if (token === "--file") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--file requires a path argument");
      }
      args.file = next;
      index += 1;
      continue;
    }
  }

  return args;
}

function parseDotenvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? "";

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function isSet(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFilePath = path.resolve(process.cwd(), args.file);
  const fileVars = parseDotenvFile(envFilePath);

  const merged = {
    ...fileVars,
    ...process.env,
  };

  const missing = REQUIRED_VARS.filter((key) => !isSet(merged[key]));
  const warnings = [];

  const authEmailSet = isSet(merged.AUTH_EMAIL);
  const authPasswordSet = isSet(merged.AUTH_PASSWORD);
  if (authEmailSet !== authPasswordSet) {
    warnings.push("Set both AUTH_EMAIL and AUTH_PASSWORD, or neither.");
  }

  const assetsFlag = merged.NEXT_PUBLIC_USE_EXTRACTED_HERO_ASSETS;
  if (isSet(assetsFlag) && assetsFlag !== "0" && assetsFlag !== "1") {
    warnings.push("NEXT_PUBLIC_USE_EXTRACTED_HERO_ASSETS should be '0' or '1'.");
  }

  if (args.prod) {
    const nextAuthUrl = String(merged.NEXTAUTH_URL ?? "").trim();
    if (!nextAuthUrl.startsWith("https://")) {
      warnings.push("Production NEXTAUTH_URL should use https://");
    }

    if (/trycloudflare\.com$/i.test(nextAuthUrl.replace(/^https?:\/\//i, ""))) {
      warnings.push("Production NEXTAUTH_URL should not be a temporary trycloudflare.com domain.");
    }
  }

  console.log(`Checking env vars (file: ${envFilePath})`);

  if (missing.length > 0) {
    console.error("\nMissing required variables:");
    for (const key of missing) {
      console.error(`- ${key}`);
    }
  }

  if (warnings.length > 0) {
    console.warn("\nWarnings:");
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (missing.length > 0) {
    process.exit(1);
  }

  console.log("\nRequired env vars are set.");
}

main();
