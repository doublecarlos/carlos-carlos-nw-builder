"""Emit compact, hand-editable JSON data files.

Same compact/wrap-at-width style as `jsemit` (one row per line where it fits, wrapped
otherwise) but with always-quoted keys and no `window.NAME = ...` wrapper, since these files
are fetched by the browser as plain data rather than executed as a script. JSON has no comment
syntax, so provenance notes ("GENERATED, don't hand-edit") live in the loader that fetches the
file (e.g. `data/slots.js`), not in the data file itself.
"""

import json

# Reuse the shortest-round-tripping number formatter -- percentages otherwise keep their long
# binary-float tails (0.09000000000000001).
from .jsemit import _num


def value(obj, indent=0, width=100):
    """Render a Python value as compact JSON, wrapping only when it exceeds `width`."""
    if obj is None:
        return "null"
    if isinstance(obj, bool):
        return "true" if obj else "false"
    if isinstance(obj, (int, float)):
        return _num(obj)
    if isinstance(obj, str):
        return json.dumps(obj, ensure_ascii=False)
    if isinstance(obj, (list, tuple)):
        parts = [value(v, indent, width) for v in obj]
        oneline = "[" + ", ".join(parts) + "]"
        if len(oneline) + indent <= width:
            return oneline
        pad = " " * (indent + 2)
        inner = [value(v, indent + 2, width) for v in obj]
        return "[\n" + ",\n".join(pad + p for p in inner) + "\n" + " " * indent + "]"
    if isinstance(obj, dict):
        parts = [f"{json.dumps(k)}: {value(v, indent + 2, width)}" for k, v in obj.items()]
        oneline = "{" + ", ".join(parts) + "}"
        if len(oneline) + indent <= width:
            return oneline
        pad = " " * (indent + 2)
        return "{\n" + ",\n".join(pad + p for p in parts) + "\n" + " " * indent + "}"
    raise TypeError(f"cannot emit {type(obj).__name__}")


def write_rows(path, rows, width=96):
    """Write a top-level JSON array, one row per line where possible."""
    body = ",\n".join("  " + value(row, 2, width=width) for row in rows)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("[\n" + body + "\n]\n" if rows else "[]\n")
