"""Emit compact, hand-editable `window.NW_* = ...` JavaScript data files.

The output must stay pleasant to edit by hand -- adding an item should be adding one line --
so this is deliberately not `json.dumps(indent=2)`.
"""

import json
import re

# Keys that are safe as bare JS identifiers (avoids quoting every single key).
_BARE_KEY = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _num(value):
    """Shortest round-tripping representation of a number."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    # Percentages arrive as long binary-float tails (0.09000000000000001). repr() would keep
    # them; round-tripping through the shortest decimal that reproduces the float does not.
    for digits in range(1, 18):
        text = f"{value:.{digits}g}"
        if float(text) == value:
            return text
    return repr(value)


def value(obj, indent=0, width=100):
    """Render a Python value as compact JS, wrapping only when it exceeds `width`."""
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
        oneline = "[" + ",".join(parts) + "]"
        if len(oneline) + indent <= width:
            return oneline
        pad = " " * (indent + 2)
        inner = [value(v, indent + 2, width) for v in obj]
        return "[\n" + ",\n".join(pad + p for p in inner) + "\n" + " " * indent + "]"
    if isinstance(obj, dict):
        parts = []
        for k, v in obj.items():
            key = k if _BARE_KEY.match(k) else json.dumps(k)
            parts.append(f"{key}:{value(v, indent + 2, width)}")
        oneline = "{" + ", ".join(parts) + "}"
        if len(oneline) + indent <= width:
            return oneline
        pad = " " * (indent + 2)
        return "{\n" + ",\n".join(pad + p for p in parts) + "\n" + " " * indent + "}"
    raise TypeError(f"cannot emit {type(obj).__name__}")


def write_file(path, global_name, rows, header_comment="", one_per_line=True):
    """Write `window.<global_name> = [ ... ];` with one row per line where possible."""
    out = []
    if header_comment:
        out.append("\n".join("// " + line for line in header_comment.strip().split("\n")))
        out.append("")
    out.append(f"window.{global_name} = [")
    for row in rows:
        text = value(row, 0)
        out.append(text + "," if one_per_line else text + ",")
    out.append("];")
    out.append("")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out))
