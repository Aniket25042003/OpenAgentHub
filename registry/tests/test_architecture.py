import ast
import importlib
import pathlib

import pytest

APP_ROOT = pathlib.Path(__file__).resolve().parents[1] / "app"

MODULES = ("identity", "registry", "security_review", "organizations", "entitlements", "audit", "outbox", "workers")


def _imports(module_path: pathlib.Path) -> list[str]:
    tree = ast.parse(module_path.read_text())
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
    return names


def _is_routes(path: pathlib.Path) -> bool:
    return path.name == "routes.py"


def _module_of(path: pathlib.Path) -> str:
    rel = path.relative_to(APP_ROOT)
    return rel.parts[0]


def test_every_module_imports_cleanly():
    for path in APP_ROOT.glob("**/*.py"):
        name = "app." + ".".join(path.relative_to(APP_ROOT).with_suffix("").parts)
        importlib.import_module(name)


def test_routes_never_import_sqlalchemy():
    for path in APP_ROOT.glob("**/*.py"):
        if not _is_routes(path):
            continue
        for imported in _imports(path):
            assert not imported.startswith("sqlalchemy") or imported == "sqlalchemy.ext.asyncio", (
                f"{path} imports {imported}; routers must stay thin"
            )


def test_routes_never_import_models():
    for path in APP_ROOT.glob("**/*.py"):
        if not _is_routes(path):
            continue
        this = _module_of(path)
        for imported in _imports(path):
            parts = imported.split(".")
            if ".models" in imported and not (len(parts) >= 3 and parts[1] == this):
                pytest.fail(f"{path} imports {imported}; routers must not touch other modules' models")


def test_no_module_imports_another_modules_routes():
    for path in APP_ROOT.glob("**/*.py"):
        if path.name == "__init__.py":
            continue
        this = _module_of(path)
        if this == "workers" or path.name == "main.py":
            continue
        for imported in _imports(path):
            parts = imported.split(".")
            if len(parts) >= 2 and parts[0] == "app" and parts[1] in MODULES and parts[1] != this:
                assert not (len(parts) >= 3 and parts[2] == "routes"), (
                    f"{path} imports {imported}; modules must not import other modules' routes"
                )


def test_workers_never_import_routers_or_main():
    for path in (APP_ROOT / "workers").glob("*.py"):
        for imported in _imports(path):
            parts = imported.split(".")
            if len(parts) >= 2 and parts[0] == "app":
                assert parts[1] not in ("main",) and not (len(parts) >= 3 and parts[2] == "routes"), (
                    f"{path} imports {imported}; workers must not import API entrypoints"
                )


def test_routes_use_application_use_cases():
    for path in APP_ROOT.glob("**/routes.py"):
        imports = _imports(path)
        assert any(i.endswith("application") for i in imports), f"{path} must delegate to application use cases"


def test_openapi_exposes_all_router_paths():
    from app.main import create_app

    app = create_app()
    paths = set(app.openapi()["paths"])
    for expected in (
        "/api/v1/auth/github",
        "/api/v1/me",
        "/api/v1/keys",
        "/api/v1/agents",
        "/api/v1/agents/{namespace}/{name}",
        "/api/v1/agents/{namespace}/{name}/versions",
        "/api/v1/agents/{namespace}/{name}/versions/{version}",
        "/api/v1/agents/{namespace}/{name}/versions/{version}/archive",
        "/api/v1/agents/{namespace}/{name}/versions/{version}/scan",
        "/health",
        "/ready",
        "/metrics",
    ):
        assert expected in paths, f"missing route {expected}"


def test_module_tables_are_owned_by_their_module():
    ownership = {
        "identity": ("users", "signing_keys"),
        "registry": ("agents", "agent_versions", "namespaces", "namespace_members"),
        "audit": ("audit_events",),
        "outbox": ("outbox_events", "queue_jobs"),
    }
    for module, tables in ownership.items():
        models_path = APP_ROOT / module / "models.py"
        text = models_path.read_text()
        for table in tables:
            assert f'__tablename__ = "{table}"' in text, f"{module} no longer owns {table}"


ALLOWED_CROSS_MODULE = {
    "security_review/adapters.py": {"registry"},
    "registry/application.py": {"security_review", "audit", "outbox", "identity", "entitlements"},
    "registry/routes.py": {"identity", "entitlements"},
    "entitlements/application.py": {"audit", "identity"},
    "identity/application.py": {"audit"},
    "workers/scan.py": {"security_review", "outbox"},
    "workers/notifications.py": {"outbox"},
    "workers/billing.py": {"outbox"},
    "workers/maintenance.py": {"outbox"},
}


def test_cross_module_references_match_allowlist():
    for path in APP_ROOT.glob("**/*.py"):
        if path.name == "__init__.py" or path.name == "main.py":
            continue
        this = _module_of(path)
        key = str(path.relative_to(APP_ROOT))
        allowed = ALLOWED_CROSS_MODULE.get(key, set())
        for imported in _imports(path):
            parts = imported.split(".")
            if len(parts) < 2 or parts[0] != "app":
                continue
            target = parts[1]
            if target not in MODULES:
                continue
            if target == this:
                continue
            assert target in allowed, f"{path} imports {imported}; add to ALLOWED_CROSS_MODULE or use a port"
