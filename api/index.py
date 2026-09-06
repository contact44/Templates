"""Vercel entry point: preview mode with demo data in the function's temporary storage."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("ASTREE_DEMO", "1")
os.environ.setdefault("ASTREE_WORKSPACE", "/tmp/astree")
os.environ.setdefault("ASTREE_SCENARIOS", str(ROOT / "scenarios"))

from astree.app import create_app  # noqa: E402

app = create_app()
