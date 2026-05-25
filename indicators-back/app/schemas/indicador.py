"""Pydantic request/response schemas for the indicador API.

These schemas define the shape of JSON payloads for the CRUD endpoints,
versioning, and resultados retrieval. They are separate from the types
in `app/types/definicion.py` — those are the internal metamodel, while
these handle HTTP serialization concerns like datetime formatting and
pagination envelopes.
"""

import uuid
from datetime import date, datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.types.definicion import DefinicionIndicador

T = TypeVar("T")


# ── Indicador CRUD ────────────────────────────────────────────────────


class IndicadorCreate(BaseModel):
    """Payload for POST /indicadores — create a new indicator definition.

    Includes the full DefinicionIndicador so version 1 is created atomically.
    """

    nombre: str = Field(
        ...,
        min_length=1,
        max_length=255,
        examples=["Tasa de Cesáreas"],
        description="Human-readable indicator name.",
    )
    descripcion: str | None = Field(
        None,
        examples=["Porcentaje de partos por cesárea sobre el total de partos."],
        description="Optional free-text description.",
    )
    definicion: DefinicionIndicador = Field(
        ...,
        description="Full indicator definition (tipo, evento, periodo, etc.) for version 1.",
    )


class IndicadorUpdate(BaseModel):
    """Payload for PUT /indicadores/{id} — update indicator metadata.

    When definicion is present and differs from the latest version, a new
    IndicadorVersion is auto-created. When absent or identical, only metadata
    (nombre, descripcion) is updated.
    """

    nombre: str = Field(
        ...,
        min_length=1,
        max_length=255,
        examples=["Tasa de Cesáreas (actualizado)"],
        description="Human-readable indicator name.",
    )
    descripcion: str | None = Field(
        None,
        examples=["Descripción actualizada."],
        description="Optional free-text description.",
    )
    definicion: DefinicionIndicador | None = Field(
        None,
        description="Optional definition. If present and different from the "
        "latest version, a new version is auto-created.",
    )


class IndicadorResponse(BaseModel):
    """Response for GET /indicadores and GET /indicadores/{id}."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    descripcion: str | None
    activo: bool
    creado_en: datetime


class IndicadorDetailResponse(IndicadorResponse):
    """Response for GET /indicadores/{id} — includes all versions."""

    versiones: list["IndicadorVersionResponse"] = []


class IndicadorListResponse(BaseModel):
    """Paginated list response for GET /indicadores."""

    items: list[IndicadorResponse]
    total: int
    page: int
    size: int
    pages: int


# ── Indicador Versioning ──────────────────────────────────────────────


class IndicadorVersionCreate(BaseModel):
    """Payload for POST /indicadores/{id}/versiones.

    Creates a new immutable version for an existing indicator.
    """

    definicion: DefinicionIndicador = Field(
        ...,
        description="Full indicator definition (tipo, evento, periodo, etc.).",
    )


class IndicadorVersionResponse(BaseModel):
    """Response for version creation and retrieval."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    indicador_id: uuid.UUID
    version: int
    definicion: dict  # JSONB deserialized as dict.
    creado_en: datetime


# ── Resultados ────────────────────────────────────────────────────────


class IndicadorResultadoResponse(BaseModel):
    """A single computed indicator result."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    indicador_version_id: uuid.UUID
    periodo_inicio: date
    periodo_fin: date
    valor: float
    calculado_en: datetime


class IndicadorResultadoEnrichedResponse(IndicadorResultadoResponse):
    """Extended resultado response that includes indicator name and version number."""

    indicador_nombre: str | None = None
    indicador_version_num: int | None = None


class ResultadoListResponse(BaseModel):
    """Filterable, paginated list of computed results."""

    items: list[IndicadorResultadoEnrichedResponse]
    total: int
    page: int
    size: int
    pages: int


class ErrorCalculo(BaseModel):
    """Individual error entry when a batch calculation fails for one indicator."""

    indicador_id: uuid.UUID
    indicador_nombre: str
    error: str


class BatchCalcularNowResponse(BaseModel):
    """Response for POST /resultados/calcular-ahora — batch calculation summary."""

    calculados: int
    errores: list[ErrorCalculo]
    total: int


# ── SQL Preview ────────────────────────────────────────────────────────


class IndicadorSQLPreviewResponse(BaseModel):
    """Response for GET /indicadores/{id}/preview-sql.

    Returns the parameterized SQL string, the parameter values that would
    be used, and the computed period dates — all without executing against
    OpenMRS. Useful for debugging and transparency in the UI.
    """

    sql: str = Field(
        ...,
        description="Parameterized MySQL query string (uses %(name)s syntax).",
    )
    params: dict = Field(
        ...,
        description="Resolved parameter values keyed by parameter name.",
    )
    periodo_inicio: date = Field(
        ...,
        description="Computed period start date from the definition's periodo.",
    )
    periodo_fin: date = Field(
        ...,
        description="Computed period end date from the definition's periodo.",
    )
    version_id: uuid.UUID = Field(
        ...,
        description="UUID of the IndicadorVersion used to generate this preview.",
    )
    version_num: int = Field(
        ...,
        description="Version number used to generate this preview.",
    )
