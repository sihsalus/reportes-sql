"""SQLAlchemy ORM models for the motor-indicadores-core domain.

Three core entities:
- Indicador: the indicator definition (name, description, active flag).
- IndicadorVersion: immutable versioned JSONB definition (append-only).
- IndicadorResultado: computed result for a specific version and period.

All models use UUID primary keys. Versioning is enforced via UNIQUE(indicador_id, version).
"""

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


class Indicador(Base):
    """An indicator definition — the top-level entity."""

    __tablename__ = "indicador"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    nombre: Mapped[str] = mapped_column(String(255), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    versiones: Mapped[list["IndicadorVersion"]] = relationship(
        back_populates="indicador", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Indicador(id={self.id!r}, nombre={self.nombre!r}, activo={self.activo})>"


class IndicadorVersion(Base):
    """An immutable version of an indicator definition (JSONB).

    Each version is a new row — previous versions are never updated.
    The UNIQUE(indicador_id, version) constraint prevents race conditions
    when two writers try to create the same version number.
    """

    __tablename__ = "indicador_version"
    __table_args__ = (
        UniqueConstraint("indicador_id", "version", name="uq_indicador_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    indicador_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("indicador.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    definicion: Mapped[dict] = mapped_column(JSONB, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    indicador: Mapped["Indicador"] = relationship(back_populates="versiones")
    resultados: Mapped[list["IndicadorResultado"]] = relationship(
        back_populates="indicador_version", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<IndicadorVersion(id={self.id!r}, indicador_id={self.indicador_id!r}, version={self.version})>"


class IndicadorResultado(Base):
    """A computed result for a specific indicator version and time period.

    Stored pre-computed so the Superset view and API queries are fast.
    """

    __tablename__ = "indicador_resultado"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    indicador_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("indicador_version.id"), nullable=False
    )
    periodo_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    periodo_fin: Mapped[date] = mapped_column(Date, nullable=False)
    valor: Mapped[float] = mapped_column(Numeric(18, 6), nullable=False)
    calculado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    indicador_version: Mapped["IndicadorVersion"] = relationship(
        back_populates="resultados"
    )

    def __repr__(self) -> str:
        return f"<IndicadorResultado(id={self.id!r}, version={self.indicador_version_id!r}, valor={self.valor})>"
