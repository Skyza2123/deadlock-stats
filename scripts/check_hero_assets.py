from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check hero asset metadata against files in public/assets."
    )
    parser.add_argument(
        "--metadata",
        default="lib/heroAssets.generated.json",
        help="Path to generated hero assets metadata JSON",
    )
    parser.add_argument(
        "--public-assets-dir",
        default="public/assets",
        help="Root folder where web paths (e.g. /assets/...) are served from",
    )
    parser.add_argument(
        "--write-report",
        default=None,
        help="Optional output JSON file for full report",
    )
    parser.add_argument(
        "--show-found",
        action="store_true",
        help="Also print found files",
    )
    return parser.parse_args()


def web_path_to_file(public_assets_dir: Path, web_path: str | None) -> Path | None:
    if not web_path or not isinstance(web_path, str):
        return None

    # expected format: /assets/heroes/...
    if not web_path.startswith("/assets/"):
        return None

    relative = web_path[len("/assets/") :]
    return public_assets_dir / relative


def main() -> None:
    args = parse_args()

    metadata_file = Path(args.metadata).expanduser().resolve()
    public_assets_dir = Path(args.public_assets_dir).expanduser().resolve()

    if not metadata_file.exists():
        raise SystemExit(f"Metadata file not found: {metadata_file}")

    payload = json.loads(metadata_file.read_text(encoding="utf-8"))
    heroes: list[dict[str, Any]] = payload.get("heroes", [])

    found: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []

    for hero in heroes:
        hero_id = hero.get("id")
        class_name = hero.get("className")
        icon_fields = hero.get("iconFields", {})

        for field_name, field_value in icon_fields.items():
            web_path = field_value.get("webPath") if isinstance(field_value, dict) else None

            target = web_path_to_file(public_assets_dir, web_path)
            row = {
                "heroId": hero_id,
                "className": class_name,
                "field": field_name,
                "webPath": web_path,
                "filePath": str(target) if target else None,
            }

            if target is None:
                invalid.append(row)
            elif target.exists():
                found.append(row)
            else:
                missing.append(row)

    total = len(found) + len(missing)
    print(f"Metadata: {metadata_file}")
    print(f"Assets dir: {public_assets_dir}")
    print(f"Checked web paths: {total}")
    print(f"Found: {len(found)}")
    print(f"Missing: {len(missing)}")
    print(f"Invalid/empty paths: {len(invalid)}")

    if missing:
        print("\nMissing files:")
        for row in missing:
            print(
                f"- hero {row['heroId']} ({row['className']}), {row['field']}: {row['webPath']}"
            )

    if args.show_found and found:
        print("\nFound files:")
        for row in found:
            print(
                f"- hero {row['heroId']} ({row['className']}), {row['field']}: {row['webPath']}"
            )

    if args.write_report:
        report_path = Path(args.write_report).expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "metadata": str(metadata_file),
            "publicAssetsDir": str(public_assets_dir),
            "found": found,
            "missing": missing,
            "invalid": invalid,
            "summary": {
                "checked": total,
                "found": len(found),
                "missing": len(missing),
                "invalid": len(invalid),
            },
        }
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nReport written to: {report_path}")


if __name__ == "__main__":
    main()
