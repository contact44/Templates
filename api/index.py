"""Vercel entry point: preview mode with demo data in the function's temporary storage."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("GREFFIER_DEMO", "1")
os.environ.setdefault("GREFFIER_WORKSPACE", "/tmp/greffier")
os.environ.setdefault("GREFFIER_ROBOTS", str(ROOT / "robots"))

from greffier.app import create_app  # noqa: E402

app = create_app()
