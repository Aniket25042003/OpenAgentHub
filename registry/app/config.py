from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="REGISTRY_", env_file=".env", extra="ignore"
    )

    database_url: str = "sqlite+aiosqlite:///./registry.db"
    storage_dir: str = "./storage"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    token_ttl_seconds: int = 7 * 24 * 3600

    github_client_id: str = ""
    github_client_secret: str = ""
    github_token_url: str = "https://github.com/login/oauth/access_token"
    github_user_url: str = "https://api.github.com/user"
    github_authorize_url: str = "https://github.com/login/oauth/authorize"
    github_state_ttl_seconds: int = 600
    github_code_ttl_seconds: int = 120
    web_redirect_uris: str = "http://localhost:3100/auth/callback"
    session_cookie_name: str = "oah_session"
    session_absolute_ttl_seconds: int = 7 * 24 * 3600
    session_idle_ttl_seconds: int = 14 * 24 * 3600
    session_rotate_after_seconds: int = 3600
    current_tos_version: int = 1
    current_privacy_version: int = 1
    current_publisher_agreement_version: int = 1

    invitation_ttl_hours: int = 72
    invitation_max_pending_per_org: int = 100

    public_base_url: str = "http://localhost:8000"
    cors_origins: str = "*"
    max_archive_bytes: int = 250 * 1024 * 1024
    max_archive_uncompressed_bytes: int = 512 * 1024 * 1024
    max_archive_entries: int = 10_000
    publish_quota_new_account_daily: int = 10
    publish_quota_new_account_days: int = 7
    publish_per_ip_per_hour: int = 120
    reserved_namespace_prefixes: str = (
        "openagenthub-,oah-,github-,google-,microsoft-,meta-,anthropic-,openai-"
    )
    outbox_poll_interval_seconds: float = 1.0
    rescan_cooldown_seconds: float = 10.0

    rate_limit_store: str = "memory"
    redis_url: str = ""
    trusted_proxies: str = ""
    anonymous_reads_per_minute: int = 300
    ip_writes_per_hour: int = 60
    account_writes_per_hour: int = 600
    downloads_per_minute_by_ip: int = 8
    download_bytes_per_hour_by_ip: int = 2 * 1024 * 1024 * 1024
    download_url_ttl_seconds: int = 300
    download_flush_seconds: float = 60.0
    catalog_cache_ttl_seconds: int = 30

    token_max_lifetime_days: int = 365
    token_default_ttl_days: int = 90
    token_max_per_account: int = 50
    token_allowed_scopes: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_proxy_set(self) -> set[str]:
        return {p.strip() for p in self.trusted_proxies.split(",") if p.strip()}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.jwt_secret == "change-me":
        import logging

        logging.getLogger("openagenthub.registry").warning(
            "REGISTRY_JWT_SECRET is still the default; set it before deploying publicly"
        )
    return settings
