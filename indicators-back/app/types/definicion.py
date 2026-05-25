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
    "mes_actual", "trimestre_actual", "semestre_actual", "anual_actual"
]


# ── Filter models ──────────────────────────────────────────────────────


class FiltrosPoblacion(BaseModel):
    """Population-level filters applied to the indicator query.

    Six canonical age fields with mutual exclusivity per bound group:
    - Min group (at most one): min_dias, min_meses, min_anios
    - Max group (at most one): max_dias, max_meses_excl, max_anios_excl

    sexo restricts the population to a single gender; None means both.
    Legacy ``edad_min_*`` / ``edad_max_*`` fields are accepted and
    normalized to canonical names via model_validator(mode='before').
    """

    min_dias: int | None = Field(default=None, ge=0)
    min_meses: int | None = Field(default=None, ge=0)
    min_anios: int | None = Field(default=None, ge=0)
    max_dias: int | None = Field(default=None, ge=0)
    max_meses_excl: int | None = Field(default=None, ge=0)
    max_anios_excl: int | None = Field(default=None, ge=0)
    sexo: Literal["M", "F"] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_age_fields(cls, data: object) -> object:
        """Map legacy edad_* field names to canonical names.

        Accepted legacy names and their canonical equivalents:
          edad_min_anios → min_anios         edad_max_anios → max_anios_excl
          edad_min_meses → min_meses         edad_max_meses → max_meses_excl
          edad_min_dias  → min_dias          edad_max_dias  → max_dias

        Mixed legacy + canonical payloads are rejected outright to
        prevent silent ambiguity during the transition window.
        """
        if not isinstance(data, dict):
            return data

        legacy_keys = {
            "edad_min_anios",
            "edad_min_meses",
            "edad_min_dias",
            "edad_max_anios",
            "edad_max_meses",
            "edad_max_dias",
        }
        canonical_keys = {
            "min_anios",
            "min_meses",
            "min_dias",
            "max_anios_excl",
            "max_meses_excl",
            "max_dias",
        }

        has_legacy = any(k in data for k in legacy_keys)
        has_canonical = any(k in data for k in canonical_keys)

        if has_legacy and has_canonical:
            raise ValueError(
                "Cannot mix legacy age fields (edad_*) with canonical "
                "age fields (min_*/max_*). Use one naming convention only."
            )

        if not has_legacy:
            return data

        mapping = {
            "edad_min_anios": "min_anios",
            "edad_min_meses": "min_meses",
            "edad_min_dias": "min_dias",
            "edad_max_anios": "max_anios_excl",
            "edad_max_meses": "max_meses_excl",
            "edad_max_dias": "max_dias",
        }

        result: dict = {}
        for key, value in data.items():
            if key in mapping:
                result[mapping[key]] = value
            elif key not in legacy_keys:
                result[key] = value
        return result

    @model_validator(mode="after")
    def _check_same_group_exclusivity(self) -> "FiltrosPoblacion":
        """Enforce mutual exclusivity within each bound group.

        At most one min_* field and at most one max_* field may be set.
        Cross-group (one min + one max) is allowed.
        """
        min_count = sum(
            1 for v in (self.min_dias, self.min_meses, self.min_anios)
            if v is not None
        )
        max_count = sum(
            1 for v in (self.max_dias, self.max_meses_excl, self.max_anios_excl)
            if v is not None
        )
        if min_count > 1:
            raise ValueError(
                "min_dias, min_meses, and min_anios are mutually "
                "exclusive — at most one may be set"
            )
        if max_count > 1:
            raise ValueError(
                "max_dias, max_meses_excl, and max_anios_excl are "
                "mutually exclusive — at most one may be set"
            )
        return self

    @property
    def has_age_filter(self) -> bool:
        """True when at least one canonical age field is explicitly set."""
        return any(
            v is not None
            for v in (
                self.min_dias,
                self.min_meses,
                self.min_anios,
                self.max_dias,
                self.max_meses_excl,
                self.max_anios_excl,
            )
        )


class FiltroDiagnostico(BaseModel):
    """Diagnosis filter using OpenMRS concept UUIDs for diagnosis_coded.

    concepto_uuids identifies one or more diagnosis concepts in OpenMRS
    by their UUID. The SQL interpreter joins encounter_diagnosis → concept
    and filters by c.uuid IN (:uuids). Multiple UUIDs within a single item
    use OR logic — the encounter must match at least one.

    tipo_diagnostico optionally restricts by certainty:
    "definitivo" → CONFIRMED, "presuntivo" → PROVISIONAL.

    An empty list means no concept filter (used as backward-compat fallback
    for old CIE-10 data that cannot be mapped to concept UUIDs).
    """

    concepto_uuids: list[str] = []
    tipo_diagnostico: Literal["definitivo", "presuntivo"] | None = None


class FiltroOrden(BaseModel):
    """Order filter using an OpenMRS concept UUID.

    Points to the orders table. Each FiltroOrden represents one concept
    that must be present as a non-voided order on every encounter counted
    by the indicator. Multiple entries use AND logic — ALL listed concepts
    must be ordered.
    """

    concepto_uuid: str = Field(..., min_length=1)


class FiltrosEvento(BaseModel):
    """Definition of the clinical event that an indicator measures.

    location_uuids identifies which OpenMRS service locations (clinics, wards,
    etc.) to filter encounters by, via JOIN location ON e.location_id.
    minimo_ocurrencias enforces a minimum encounter-count threshold per patient.
    diagnosticos and ordenes are mutually exclusive — only one may be set.

    Legacy encounter_type_uuids in stored JSONB are normalized to location_uuids
    by the before-validator for read compatibility.
    """

    location_uuids: list[str] | None = None
    minimo_ocurrencias: int | None = Field(default=None, ge=1)
    diagnosticos: list[FiltroDiagnostico] | None = None
    ordenes: list[FiltroOrden] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_encounter_types(cls, data: object) -> object:
        """Map legacy encounter_type_uuids → location_uuids on read.

        Stored JSONB may still contain encounter_type_uuids. This validator
        handles three shapes:
        - FiltrosEvento dict with encounter_type_uuids key
        - Raw JSONB dict passed through DefinicionIndicador's before-validator
        - Already-normalized dict (location_uuids present, pass through)
        """
        if not isinstance(data, dict):
            return data

        if "location_uuids" in data:
            # Already has new field — pop legacy key if present
            data.pop("encounter_type_uuids", None)
            return data

        if "encounter_type_uuids" in data:
            data["location_uuids"] = data.pop("encounter_type_uuids")

        return data

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
                # Preserve the tipo_diagnostico with empty concepto_uuids
                # (old CIE-10 codes cannot be converted to concept UUIDs)
                evento["diagnosticos"] = [
                    {
                        "concepto_uuids": [],
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
