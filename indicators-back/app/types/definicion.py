"""Pydantic v2 metamodel for indicator definitions.

Pure Pydantic types with zero ORM coupling. These models are the canonical
representation of an indicator definition, used both for API validation
and SQL generation in the engine layer.

Format validation lives here — existence checks (OpenMRS UUID resolution)
are deferred to the router/validator layer (I/O), keeping models
side-effect-free and testable in isolation.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# ── Type aliases ───────────────────────────────────────────────────────

TipoIndicador = Literal["conteo_atenciones", "conteo_pacientes"]

PeriodoIndicador = Literal[
    "mes_actual", "mes_anterior", "semana_actual", "semana_anterior"
]


# ── Filter models ──────────────────────────────────────────────────────


class FiltrosPoblacion(BaseModel):
    """Population-level filters applied to the indicator query.

    All age fields are optional; if none are set, no age filter is applied.
    Age bounds can be expressed in years, months, and/or days — they are
    combined into a single day value internally (365 d/yr, 30 d/mo approx).
    sexo restricts the population to a single gender; None means both.
    """

    edad_min_anios: int | None = None
    edad_max_anios: int | None = None
    edad_min_meses: int | None = None
    edad_max_meses: int | None = None
    edad_min_dias: int | None = None
    edad_max_dias: int | None = None
    sexo: Literal["M", "F"] | None = None

    @property
    def has_age_filter(self) -> bool:
        """True when at least one age field is explicitly set."""
        return any(
            v is not None
            for v in (
                self.edad_min_anios,
                self.edad_max_anios,
                self.edad_min_meses,
                self.edad_max_meses,
                self.edad_min_dias,
                self.edad_max_dias,
            )
        )

    @property
    def edad_min_total_dias(self) -> int:
        """Combined minimum age in days (años*365 + meses*30 + días)."""
        anios = (self.edad_min_anios or 0) * 365
        meses = (self.edad_min_meses or 0) * 30
        dias = self.edad_min_dias or 0
        return anios + meses + dias

    @property
    def edad_max_total_dias(self) -> int:
        """Combined maximum age in days, or a large fallback if unset."""
        if (
            self.edad_max_anios is None
            and self.edad_max_meses is None
            and self.edad_max_dias is None
        ):
            return 365 * 150  # ~150 years — effectively no upper bound
        anios = (self.edad_max_anios or 0) * 365
        meses = (self.edad_max_meses or 0) * 30
        dias = self.edad_max_dias or 0
        return anios + meses + dias


class FiltroDiagnostico(BaseModel):
    """Diagnosis filter using OpenMRS concept UUID for diagnosis_coded.

    concepto_uuid identifies a diagnosis concept in OpenMRS. The SQL
    interpreter resolves it to a concept_id and filters encounter_diagnosis.
    tipo_diagnostico optionally restricts by diagnosis type.

    concepto_uuid is a plain str — format/existence validation is deferred
    to the router layer. An empty string means no concept filter (used as
    backward-compat fallback for old CIE-10 data that cannot be mapped).
    """

    concepto_uuid: str
    tipo_diagnostico: Literal["definitivo", "presuntivo"] | None = None


class FiltroOrden(BaseModel):
    """Order filter using an OpenMRS concept UUID.

    Replaces FiltroObservacion — points to the orders table instead of obs.
    Each FiltroOrden represents one concept that must be present as a
    non-voided order on every encounter counted by the indicator.
    Multiple entries use AND logic — ALL listed concepts must be ordered.
    """

    concepto_uuid: str = Field(..., min_length=1)


class FiltrosEvento(BaseModel):
    """Definition of the clinical event that an indicator measures.

    encounter_type_uuids identifies which OpenMRS encounter types to count.
    minimo_ocurrencias enforces a minimum encounter-count threshold per patient.
    diagnosticos and ordenes are mutually exclusive — only one may be set.
    """

    encounter_type_uuids: list[str] | None = None
    minimo_ocurrencias: int | None = Field(default=None, ge=1)
    diagnosticos: list[FiltroDiagnostico] | None = None
    ordenes: list[FiltroOrden] | None = None

    @model_validator(mode="after")
    def _mutual_exclusivity(self) -> "FiltrosEvento":
        has_diag = self.diagnosticos is not None and len(self.diagnosticos) > 0
        has_ord = self.ordenes is not None and len(self.ordenes) > 0
        if has_diag and has_ord:
            raise ValueError(
                "diagnosticos and ordenes are mutually exclusive"
            )
        return self


# ── Top-level definition ───────────────────────────────────────────────


class DefinicionIndicador(BaseModel):
    """Top-level indicator definition — the canonical representation.

    This is what gets stored as JSONB in IndicadorVersion.definicion.
    The SQL engine reads this and generates parameterized MySQL queries.

    evento is now singular (was a list). diagnosticos and ordenes live
    nested inside evento. Old flat JSONB rows (with top-level diagnostico
    and observaciones) are normalized by the model_validator(mode='before').
    """

    tipo: TipoIndicador
    periodo: PeriodoIndicador
    poblacion: FiltrosPoblacion | None = None
    evento: FiltrosEvento | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_flat_jsonb(cls, data: object) -> object:
        """Normalize old flat JSONB shapes into the new nested evento structure.

        Old JSONB has top-level `diagnostico` and `observaciones` as peers
        of `evento`. This validator hoists them into `evento.diagnosticos`
        and `evento.ordenes`, maintaining idempotency (double-parse works).

        Also handles the old `eventos` array (picks first element) for
        backward compatibility with multi-evento data.

        When evento is already a model instance (not a dict), the data is
        new-format — pass through unchanged.
        """
        if not isinstance(data, dict):
            return data

        # ── Normalize old eventos array → singular evento ──
        if "evento" not in data and "eventos" in data:
            eventos = data.pop("eventos")
            if isinstance(eventos, list) and len(eventos) > 0:
                data["evento"] = dict(eventos[0])

        # ── Already in new shape? (evento is a model instance or nested dict) ──
        evento = data.get("evento")
        if not isinstance(evento, dict):
            # Model instance — already validated, pass through
            data.pop("diagnostico", None)
            data.pop("observaciones", None)
            return data

        if "diagnosticos" in evento or "ordenes" in evento:
            # Already nested — pass through unchanged
            data.pop("diagnostico", None)
            data.pop("observaciones", None)
            return data

        # ── Normalize old flat shape ──
        normalized = dict(data)
        old_diag = normalized.pop("diagnostico", None)
        old_obs = normalized.pop("observaciones", None)

        # ── Old diagnostico → evento.diagnosticos ──
        if isinstance(old_diag, dict):
            tipo = old_diag.get("tipo_diagnostico")
            if tipo is not None:
                # Preserve the tipo_diagnostico with empty concepto_uuid
                # (old CIE-10 codes cannot be converted to concept UUIDs)
                evento["diagnosticos"] = [
                    {
                        "concepto_uuid": "",
                        "tipo_diagnostico": tipo,
                    }
                ]

        # ── Old observaciones → evento.ordenes ──
        if isinstance(old_obs, list):
            ordenes = []
            for obs in old_obs:
                if isinstance(obs, dict) and obs.get("concepto_uuid"):
                    ordenes.append({"concepto_uuid": obs["concepto_uuid"]})
            if ordenes:
                evento["ordenes"] = ordenes

        normalized["evento"] = evento
        return normalized
