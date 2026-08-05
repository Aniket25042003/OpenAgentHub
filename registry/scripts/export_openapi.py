"""Export the registry OpenAPI document to openapi/registry-openapi.json.

The snapshot is committed and CI fails on drift (git diff --exit-code).
"""

import json
import sys
from pathlib import Path

REGISTRY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REGISTRY_ROOT))

from app.main import create_app  # noqa: E402

OUT = REGISTRY_ROOT / "openapi" / "registry-openapi.json"


def main() -> None:
    app = create_app()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUT.relative_to(REGISTRY_ROOT)}")


if __name__ == "__main__":
    main()
