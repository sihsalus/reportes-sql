"""Application configuration via pydantic-settings.

All database and API connection parameters are loaded from environment variables
and validated at startup. Individual host/port/name/user/password vars are used
instead of monolithic DSN strings to keep configuration granular and debuggable.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centralized application settings loaded from environment variables.

    PostgreSQL (async, read/write) — our indicators database.
    MySQL (sync, read-only) — external OpenMRS data.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ── PostgreSQL: Indicators database (async, read/write) ──
    indicadores_db_host: str = "localhost"
    indicadores_db_port: int = 5432
    indicadores_db_name: str = "indicators"
    indicadores_db_user: str = "postgres"
    indicadores_db_password: str = "admin"

    # ── MySQL: OpenMRS database (sync, read-only) ──
    openmrs_db_host: str = "localhost"
    openmrs_db_port: int = 3306
    openmrs_db_name: str = "openmrs"
    openmrs_db_user: str = "openmrs"
    openmrs_db_password: str = "openmrs"

    # ── OpenMRS REST API ──
    openmrs_api_url: str = "http://localhost:8080/openmrs"
    openmrs_api_user: str = "admin"
    openmrs_api_password: str = "admin"

    # ── Application ──
    port: int = 8000

    # ── Computed DSN properties ─────────────────────────────────────

    @property
    def indicadores_database_url(self) -> str:
        """Async PostgreSQL connection URL for SQLAlchemy async engine."""
        return (
            f"postgresql+asyncpg://{self.indicadores_db_user}:"
            f"{self.indicadores_db_password}@{self.indicadores_db_host}:"
            f"{self.indicadores_db_port}/{self.indicadores_db_name}"
        )

    @property
    def indicadores_database_sync_url(self) -> str:
        """Sync PostgreSQL connection URL (psycopg2) for Alembic migrations."""
        return (
            f"postgresql+psycopg2://{self.indicadores_db_user}:"
            f"{self.indicadores_db_password}@{self.indicadores_db_host}:"
            f"{self.indicadores_db_port}/{self.indicadores_db_name}"
        )

    @property
    def openmrs_database_url(self) -> str:
        """Sync MySQL connection URL for OpenMRS read-only engine."""
        return (
            f"mysql+pymysql://{self.openmrs_db_user}:"
            f"{self.openmrs_db_password}@{self.openmrs_db_host}:"
            f"{self.openmrs_db_port}/{self.openmrs_db_name}"
        )


# Singleton instance — import this everywhere.
settings = Settings()
