"""Shared library for the Neverwinter builder data pipeline.

Only `sheets` imports third-party code (the official Google libraries). Everything else is
stdlib-only so the pipeline runs offline from `data/raw/`.
"""

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def repo_path(*parts):
    """Absolute path inside the repo, regardless of the current working directory."""
    return os.path.join(REPO_ROOT, *parts)


def ensure_importable():
    """Allow `import nwtools` from scripts run as `python tools/foo.py`."""
    tools_dir = repo_path("tools")
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
