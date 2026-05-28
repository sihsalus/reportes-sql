"""Period calculation helper — shared between routers.

Extracted from resultados.py so the SQL preview endpoint can reuse
the same period calculation logic without circular imports.
"""

from calendar import monthrange
from datetime import date, timedelta


# Mapping from periodo literals to (inicio, fin) relative to today.
def calcular_periodo(periodo: str) -> tuple[date, date]:
    """Translate a periodo literal into a concrete (inicio, fin) date pair.

    Uses Python's calendar.monthrange for accurate month boundaries and
    datetime.weekday() (Monday=0) for week boundaries.

    Raises ValueError for unknown periodo literals.
    """
    hoy = date.today()

    if periodo == "mes_actual":
        inicio = hoy.replace(day=1)
        return inicio, hoy

    if periodo == "trimestre_actual":
        trimestre = (hoy.month - 1) // 3
        inicio_mes = trimestre * 3 + 1
        inicio = hoy.replace(month=inicio_mes, day=1)
        return inicio, hoy

    if periodo == "semestre_actual":
        inicio_mes = 1 if hoy.month <= 6 else 7
        inicio = hoy.replace(month=inicio_mes, day=1)
        return inicio, hoy

    if periodo == "anual_actual":
        inicio = hoy.replace(month=1, day=1)
        return inicio, hoy

    raise ValueError(f"Periodo desconocido: {periodo}")
