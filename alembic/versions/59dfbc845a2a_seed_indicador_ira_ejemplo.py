"""seed_indicador_ira_ejemplo

Revision ID: 59dfbc845a2a
Revises: 045d52951a67
Create Date: 2026-05-20 14:25:46.985476
"""

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "59dfbc845a2a"
down_revision: Union[str, Sequence[str], None] = "045d52951a67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Seed UUIDs — stable across runs so upgrade/downgrade are deterministic.
_IRA_ID = "e1a2b3c4-5501-4800-a000-000000000001"
_IRA_VERSION_ID = "e1a2b3c4-5501-4800-a000-000000000002"

_IRA_DEFINICION = {
    "tipo": "conteo_atenciones",
    "periodo": "mes_actual",
    "poblacion": {"max_anios_excl": 5},
    "evento": {
        "location_uuids": ["uuid-consulta-externa"],
        "diagnosticos": [
            {
                "concepto_uuids": ["00000000-0000-0000-0000-000000000ira"],
                "tipo_diagnostico": "definitivo",
            },
        ],
    },
}

# Reference table metadata so op.bulk_insert knows column types
_indicador = sa.table(
    "indicador",
    sa.column("id", postgresql.UUID),
    sa.column("nombre", sa.String),
    sa.column("descripcion", sa.Text),
    sa.column("activo", sa.Boolean),
)

_indicador_version = sa.table(
    "indicador_version",
    sa.column("id", postgresql.UUID),
    sa.column("indicador_id", postgresql.UUID),
    sa.column("version", sa.Integer),
    sa.column("definicion", postgresql.JSONB),
)


def upgrade() -> None:
    op.bulk_insert(
        _indicador,
        [
            {
                "id": _IRA_ID,
                "nombre": "IRA en menores de 5 años",
                "descripcion": "Infección Respiratoria Aguda — MINSA Perú",
                "activo": True,
            },
        ],
    )

    op.bulk_insert(
        _indicador_version,
        [
            {
                "id": _IRA_VERSION_ID,
                "indicador_id": _IRA_ID,
                "version": 1,
                "definicion": _IRA_DEFINICION,
            },
        ],
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM indicador_version WHERE id = CAST(:id AS uuid)")
        .bindparams(id=_IRA_VERSION_ID)
    )
    op.execute(
        sa.text("DELETE FROM indicador WHERE id = CAST(:id AS uuid)")
        .bindparams(id=_IRA_ID)
    )
