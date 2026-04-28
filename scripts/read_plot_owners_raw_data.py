from __future__ import annotations

import argparse
import os
import re
import sys


def _safe_name(sheet_name: str) -> str:
    s = sheet_name.strip() or "sheet"
    s = re.sub(r"[^A-Za-z0-9 _-]+", "_", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s or "sheet"


def main() -> int:
    parser = argparse.ArgumentParser(description="Read an Excel file and export sheets to CSV.")
    parser.add_argument(
        "--input",
        default=r"C:\Users\hechaudh\Desktop\Own\Society\Plot Owners raw data.xlsx",
        help="Path to the .xlsx file",
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.join(os.getcwd(), "plot_owners_raw_data_export"),
        help="Output directory for per-sheet CSVs",
    )
    parser.add_argument(
        "--preview-rows",
        type=int,
        default=30,
        help="Number of rows to print per sheet as a preview",
    )
    args = parser.parse_args()

    # Windows consoles often default to cp1252, which can fail for names/addresses.
    # Force UTF-8 output and replace unencodable characters rather than crashing.
    try:  # Python 3.7+
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    try:
        import pandas as pd
    except Exception as e:  # pragma: no cover
        print("ERROR: pandas is required to read .xlsx files.", file=sys.stderr)
        print(f"Import error: {e}", file=sys.stderr)
        return 2

    in_path = args.input
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    xl = pd.ExcelFile(in_path)
    print(f"Workbook: {in_path}")
    print(f"Sheets ({len(xl.sheet_names)}): {xl.sheet_names}")

    for sheet_name in xl.sheet_names:
        df = pd.read_excel(in_path, sheet_name=sheet_name, dtype=object)
        df.columns = [str(c) for c in df.columns]

        csv_path = os.path.join(out_dir, f"{_safe_name(sheet_name)}.csv")
        df.to_csv(csv_path, index=False)

        print("\n=== Sheet:", sheet_name, "===")
        print("shape:", df.shape)
        with pd.option_context("display.max_columns", 200, "display.width", 200):
            print(df.head(args.preview_rows).to_string(index=False))

    print(f"\nExported CSVs to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

