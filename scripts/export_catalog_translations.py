"""Regenerate the reviewable bilingual table from v2 and the UI display glossary."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from catalog_store import CatalogStore  # noqa: E402

OUTPUT = ROOT / "catalog" / "catalog-translations.zh.csv"
def render():
    catalog = CatalogStore()
    rows = catalog.translation_rows()
    if len(rows) != len(catalog.entities) + len(catalog.fields):
        raise ValueError("Translation table does not cover every catalog identity")
    if any(not row["display_zh"] for row in rows):
        raise ValueError("Translation table has an empty Chinese display label")
    return catalog.translation_csv()


if __name__ == "__main__":
    content = render()
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            raise SystemExit("Bilingual table is stale; regenerate it")
        print(f"Checked {OUTPUT}")
    else:
        OUTPUT.write_text(content, encoding="utf-8")
        print(f"Wrote {OUTPUT}")
