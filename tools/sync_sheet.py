"""Pull the raw item database and build-sheet slot layout out of the Google Sheet.

Writes `data/raw/db-items.json` and `data/raw/slots.json`. This is the only ingestion step;
everything downstream (migration, the legacy oracle, the validator) reads that JSON, so the
rest of the pipeline is reproducible without network access or credentials.

The slot layout is derived rather than transcribed: 221 rows of label/filter pairs is far too
much to retype accurately, and the sheet already encodes the binding as a data-validation
range pointing at one of the filtered dropdown columns.

Usage:
    ./venv/Scripts/python.exe tools/sync_sheet.py [--creds PATH] [--items-only]
"""

import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import repo_path            # noqa: E402
from nwtools import sheets               # noqa: E402

HEADER_ROW = 2          # db-items column names live in row 2
FIRST_DATA_ROW = 3

# test-dev layout
SLOT_FIRST_ROW = 13
SLOT_LAST_ROW = 234
DROPDOWN_HEADER_ROW = 14    # row 14 names each filtered dropdown column after its `filter`


def fetch_items(svc):
    """Return (columns, items) from the db-items sheet."""
    rows = sheets.read(svc, ["db-items"])["db-items"]
    if len(rows) < FIRST_DATA_ROW:
        raise SystemExit("db-items looks empty")

    columns = [str(c).strip() for c in rows[HEADER_ROW - 1]]
    if columns[0] != "name":
        raise SystemExit(f"unexpected header row: {columns[:5]}")

    items = []
    for raw in rows[FIRST_DATA_ROW - 1:]:
        record = {}
        for col, cell in zip(columns, raw):
            if not col or cell == "" or cell is None:
                continue
            record[col] = cell
        if str(record.get("name", "")).strip():
            items.append(record)
    return columns, items


def col_index(letters):
    """'DX' -> 0-based column index."""
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def fetch_slots(svc):
    """Return the build sheet's slot list: section headers and their filter-bound slots.

    Each slot's `filter` comes from its data-validation range: `=$DX$15:$DX` points at the
    dropdown column whose row-14 header is the `db-items` filter name.
    """
    values = sheets.read(svc, ["test-dev"])["test-dev"]

    def cell(row, col):
        r = values[row - 1] if row - 1 < len(values) else []
        return r[col] if col < len(r) else ""

    # dropdown column index -> filter name
    dropdown_filters = {}
    header = values[DROPDOWN_HEADER_ROW - 1]
    for idx, name in enumerate(header):
        if isinstance(name, str) and re.match(r"^[a-z][a-z0-9_]*$", name.strip()):
            dropdown_filters[idx] = name.strip()

    validation = sheets.read_validation(
        svc, f"test-dev!K{SLOT_FIRST_ROW}:K{SLOT_LAST_ROW}"
    )

    label_col, choice_col = col_index("I"), col_index("K")
    entries = []
    for offset in range(SLOT_LAST_ROW - SLOT_FIRST_ROW + 1):
        row = SLOT_FIRST_ROW + offset
        label = str(cell(row, label_col)).strip()
        if not label:
            continue

        dv_row = validation[offset] if offset < len(validation) else []
        dv = dv_row[0] if dv_row else None

        current = cell(row, choice_col)
        entry = {"row": row, "label": label}
        if dv is None:
            # No validation: either a section header (blank choice) or a cell whose value is
            # mirrored from the top control panel / typed in directly.
            entry["kind"] = "section" if current == "" else "derived"
        elif dv["type"] == "ONE_OF_RANGE":
            match = re.match(r"^=\$?([A-Z]{1,3})\$?\d+", dv["values"][0])
            idx = col_index(match.group(1)) if match else None
            entry["kind"] = "item"
            entry["filter"] = dropdown_filters.get(idx)
            if entry["filter"] is None:
                entry["unresolvedRange"] = dv["values"][0]
        elif dv["type"] == "ONE_OF_LIST":
            entry["kind"] = "enum"
            entry["options"] = dv["values"]
        elif dv["type"] == "BOOLEAN":
            entry["kind"] = "boolean"
        else:
            entry["kind"] = "unknown"
            entry["validation"] = dv

        if current != "":
            entry["current"] = current
        entries.append(entry)
    return entries


def fetch_controls(svc):
    """The top control panel: 5 effect checkboxes (I2:J6) and 3 selects (I7:I9).

    These are what become `build.context` in the new model; the slot rows at 22-29 merely
    mirror them into the item lookup.
    """
    values = sheets.read(svc, ["test-dev!I2:J9"])["test-dev!I2:J9"]
    validation = sheets.read_validation(svc, "test-dev!I2:I9")

    dropdown_filters = {}
    header = sheets.read(svc, ["test-dev!14:14"])["test-dev!14:14"]
    if header:
        for idx, name in enumerate(header[0]):
            if isinstance(name, str) and re.match(r"^[a-z][a-z0-9_]*$", name.strip()):
                dropdown_filters[idx] = name.strip()

    controls = []
    for offset in range(8):
        row = 2 + offset
        cells = values[offset] if offset < len(values) else []
        label = str(cells[0]).strip() if cells else ""
        if not label:
            continue
        entry = {"row": row, "label": label}
        dv_row = validation[offset] if offset < len(validation) else []
        dv = dv_row[0] if dv_row else None
        if dv and dv["type"] == "ONE_OF_RANGE":
            match = re.match(r"^=\$?([A-Z]{1,3})\$?\d+", dv["values"][0])
            idx = col_index(match.group(1)) if match else None
            entry["kind"] = "select"
            entry["filter"] = dropdown_filters.get(idx)
            entry["current"] = label
        else:
            entry["kind"] = "toggle"
            entry["current"] = bool(cells[1]) if len(cells) > 1 else False
        controls.append(entry)
    return controls


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False, sort_keys=False)
        fh.write("\n")
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--creds", default=None, help="service-account JSON path")
    ap.add_argument("--items-only", action="store_true", help="skip the slot layout")
    args = ap.parse_args()

    svc = sheets.connect(args.creds)
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    columns, items = fetch_items(svc)
    write_json(repo_path("data", "raw", "db-items.json"), {
        "spreadsheetId": sheets.SPREADSHEET_ID,
        "sheet": "db-items",
        "fetchedAt": stamp,
        "columns": columns,
        "items": items,
    })
    print(f"  {len(items)} items, {len(columns)} columns")

    if args.items_only:
        return

    slots = fetch_slots(svc)
    controls = fetch_controls(svc)
    write_json(repo_path("data", "raw", "slots.json"), {
        "spreadsheetId": sheets.SPREADSHEET_ID,
        "sheet": "test-dev",
        "fetchedAt": stamp,
        "controls": controls,
        "slots": slots,
    })
    kinds = {}
    for entry in slots:
        kinds[entry["kind"]] = kinds.get(entry["kind"], 0) + 1
    unresolved = [e["label"] for e in slots if e.get("unresolvedRange")]
    print(f"  {len(slots)} rows: " + ", ".join(f"{v} {k}" for k, v in sorted(kinds.items())))
    if unresolved:
        print(f"  WARNING unresolved filter for: {unresolved}")


if __name__ == "__main__":
    main()
