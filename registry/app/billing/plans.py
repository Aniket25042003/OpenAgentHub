"""M-8.10 Billing plan catalog and entitlements.

Plans are defined here, independently from UI display. Each plan grants a set
of entitlements that map onto the quota dimensions enforced in
``app.quotas`` plus audit retention and support level. The catalog is the
entitlement boundary: later paid-plan launches change the catalog, never the
authorization logic.
"""

from app.config import get_settings

FREE_HANDLE = "free"

ENTITLEMENT_KEYS = (
    "packages",
    "versions",
    "storageBytes",
    "downloadBytesPerMonth",
    "members",
    "serviceAccounts",
    "auditRetentionDays",
)


def _free_entitlements() -> dict[str, int]:
    s = get_settings()
    return {
        "packages": s.org_quota_default_packages,
        "versions": s.org_quota_default_versions,
        "storageBytes": s.org_quota_default_storage_bytes,
        "downloadBytesPerMonth": s.org_quota_default_download_bytes_per_month,
        "members": s.org_quota_default_members,
        "serviceAccounts": s.org_quota_default_service_accounts,
        "auditRetentionDays": s.org_audit_retention_default_days,
    }


def build_catalog() -> dict[str, dict]:
    return {
        "free": {
            "name": "Free",
            "supportLevel": "community",
            "launchable": True,
            "entitlements": _free_entitlements(),
        },
        "pro": {
            "name": "Pro",
            "supportLevel": "standard",
            "launchable": False,
            "entitlements": {
                "packages": 500,
                "versions": 2_500,
                "storageBytes": 25 * 1024 * 1024 * 1024,
                "downloadBytesPerMonth": 500 * 1024 * 1024 * 1024,
                "members": 150,
                "serviceAccounts": 50,
                "auditRetentionDays": 365,
            },
        },
        "enterprise": {
            "name": "Enterprise",
            "supportLevel": "priority",
            "launchable": False,
            "entitlements": {
                "packages": 5_000,
                "versions": 25_000,
                "storageBytes": 250 * 1024 * 1024 * 1024,
                "downloadBytesPerMonth": 5_000 * 1024 * 1024 * 1024,
                "members": 1_000,
                "serviceAccounts": 500,
                "auditRetentionDays": 365 * 2,
            },
        },
    }


_CATALOG = build_catalog()


def plans() -> dict[str, dict]:
    return _CATALOG


def entitlements(handle: str) -> dict[str, int]:
    return dict(_CATALOG[handle]["entitlements"])


def plan_meta(handle: str) -> dict:
    return {k: v for k, v in _CATALOG[handle].items() if k != "entitlements"}