from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="REGISTRY_", env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./registry.db"
    storage_dir: str = "./storage"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    token_ttl_seconds: int = 7 * 24 * 3600

    github_client_id: str = ""
    github_client_secret: str = ""
    github_token_url: str = "https://github.com/login/oauth/access_token"
    github_user_url: str = "https://api.github.com/user"

    public_base_url: str = "http://localhost:8000"
    cors_origins: str = "*"
    max_archive_bytes: int = 250 * 1024 * 1024
    outbox_poll_interval_seconds: float = 1.0

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.jwt_secret == "change-me":
        import logging

        logging.getLogger("openagenthub.registry").warning(
            "REGISTRY_JWT_SECRET is still the default; set it before deploying publicly"
        )
    return settings
