"""crear vista superset v_resultados_indicadores

Revision ID: 045d52951a67
Revises: 1dd84da0a437
Create Date: 2026-05-05 07:17:49.175173
"""

from alembic import op

revision: str = "045d52951a67"
down_revision = "1dd84da0a437"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE VIEW v_resultados_indicadores AS
        SELECT
            i.id          AS indicador_id,
            i.nombre      AS indicador_nombre,
            i.activo      AS indicador_activo,
            iv.version    AS version_numero,
            iv.definicion AS definicion_json,
            ir.id          AS resultado_id,
            ir.periodo_inicio,
            ir.periodo_fin,
            ir.valor,
            ir.calculado_en
        FROM indicador i
        JOIN indicador_version iv ON iv.indicador_id = i.id
        JOIN indicador_resultado ir ON ir.indicador_version_id = iv.id
    """)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_resultados_indicadores")
