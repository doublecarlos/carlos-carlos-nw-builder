# tools/

Permanent Python scripts for the data pipeline. **Stdlib only**, with one exception: the official
Google libraries (`google-auth`, `google-api-python-client`) for Sheets access. No other
third-party packages.

Run everything under the repo venv:

```sh
./venv/Scripts/python.exe tools/<script>.py
```

Throwaway investigation scripts do **not** belong here — they go in `workspace/`, which is
gitignored.

| Script | Purpose |
|---|---|
| `sync_sheet.py` | Pull `db-items` (and `test-dev` build state) from the Google Sheet into `data/raw/`. One-way import; the Sheet is authoritative only until migration is signed off. |
| `migrate_bonuses.py` | Convert the legacy bonus encoding into the new schema. Emits `data/db-items.json`, `data/db-bonuses.json` and a review report. |
| `legacy_engine.py` | **Throwaway.** Reference implementation of the *legacy* sheet semantics, used only as a test oracle to prove the migration changed nothing unintended. Delete once migration is signed off. |
| `make_fixture.py` | Capture a `test-dev` state (inputs + computed outputs) as a golden fixture. |
| `validate_db.py` | Lint the emitted database. |

`nwtools/` is the shared library:

| Module | Purpose |
|---|---|
| `sheets.py` | Minimal Google Sheets v4 read client (the only module importing `google.*`). |
| `rawdb.py` | Load/normalise the raw `db-items` dump. Stdlib only. |
| `jsemit.py` | Emit compact, hand-editable `window.NW_* = …` JS data files (test fixtures under `tests/`). Stdlib only. |
| `jsonemit.py` | Same compact/wrapped style as `jsemit`, but valid JSON (quoted keys, no wrapper) for the `data/*.json` app data files. Stdlib only. |

Only `sheets.py` touches the network or the credentials. Everything downstream reads
`data/raw/*.json`, so migration, the oracle and the validator are reproducible offline.

## Credentials

`sync_sheet.py` and `make_fixture.py` read a Google service-account JSON from
`env/google-creds.json`. Override with `--creds PATH` or the `NW_GOOGLE_CREDS` environment
variable; the spreadsheet id can likewise be overridden with `NW_SPREADSHEET_ID`.

`env/` is gitignored — the credentials are never committed.
