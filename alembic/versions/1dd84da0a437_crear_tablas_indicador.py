"""crear tablas indicador, indicador_version, indicador_resultado

Revision ID: 1dd84da0a437
Revises:
Create Date: 2026-05-05 07:17:06.013629
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "1dd84da0a437"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── indicador ──────────────────────────────────────────────────
    op.create_table(
        "indicador",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column("nombre", sa.String(255), nullable=False),
        sa.Column("descripcion", sa.Text, nullable=True),
        sa.Column(
            "activo",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ── indicador_version ──────────────────────────────────────────
    op.create_table(
        "indicador_version",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "indicador_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("indicador.id"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("definicion", postgresql.JSONB, nullable=False),
        sa.Column(
            "creado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "indicador_id", "version", name="uq_indicador_version"
        ),
    )

    # ── indicador_resultado ────────────────────────────────────────
    op.create_table(
        "indicador_resultado",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "indicador_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("indicador_version.id"),
            nullable=False,
        ),
        sa.Column("periodo_inicio", sa.Date, nullable=False),
        sa.Column("periodo_fin", sa.Date, nullable=False),
        sa.Column("valor", sa.Numeric(18, 6), nullable=False),
        sa.Column(
            "calculado_en",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("indicador_resultado")
    op.drop_table("indicador_version")
    op.drop_table("indicador")
