"""Unit and structure tests for the query executor.

Since the executor requires live MySQL and PostgreSQL connections,
these tests validate the module structure, imports, and function
signatures without hitting real databases.
"""

import uuid
from datetime import date

import pytest

from app.engine import executor as ex


class TestExecutorImports:
    """Verify the executor module is importable and exposes expected symbols."""

    def test_execute_and_persist_exists(self) -> None:
        """The sync entry point is importable."""
        assert callable(ex.execute_and_persist)

    def test_execute_and_persist_async_exists(self) -> None:
        """The async entry point is importable."""
        assert callable(ex.execute_and_persist_async)


class TestExecutorSignature:
    """Verify function signatures accept the expected parameter types."""

    def test_execute_and_persist_signature(self) -> None:
        """Parameters include query_sql, params, version_id, and period dates."""
        import inspect

        sig = inspect.signature(ex.execute_and_persist)
        param_names = list(sig.parameters.keys())
        assert "query_sql" in param_names
        assert "params" in param_names
        assert "indicador_version_id" in param_names
        assert "periodo_inicio" in param_names
        assert "periodo_fin" in param_names

    def test_execute_and_persist_async_signature(self) -> None:
        """Async version has the same parameters."""
        import inspect

        sig = inspect.signature(ex.execute_and_persist_async)
        param_names = list(sig.parameters.keys())
        assert "query_sql" in param_names
        assert "params" in param_names
        assert "indicador_version_id" in param_names


class TestExecutorConstruction:
    """Structural tests — verifies the executor can be wired without DB."""

    def test_module_imports_without_side_effects(self) -> None:
        """Importing the module should not trigger DB connections (lazy init)."""
        # The executor module is already imported above without errors.
        # Verifying that the lazy singletons haven't been forced:
        from app.database import _sync_engine

        # _sync_engine is None until get_sync_engine() is called
        assert _sync_engine is None

    def test_indicador_resultado_model_importable(self) -> None:
        """IndicadorResultado ORM class is accessible from the executor."""
        from app.models.indicador import IndicadorResultado

        # Verify it has the expected fields
        assert hasattr(IndicadorResultado, "id")
        assert hasattr(IndicadorResultado, "indicador_version_id")
        assert hasattr(IndicadorResultado, "periodo_inicio")
        assert hasattr(IndicadorResultado, "periodo_fin")
        assert hasattr(IndicadorResultado, "valor")
        assert hasattr(IndicadorResultado, "calculado_en")
