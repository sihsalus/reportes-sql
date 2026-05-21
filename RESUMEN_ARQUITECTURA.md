# Indicators — Resumen de arquitectura y avance

**Sistema de indicadores clínicos sobre OpenMRS.** Lee datos de encuentros
médicos desde el MySQL de OpenMRS, los procesa según definiciones configurables
por el usuario, y expone resultados via API REST + SPA en React.

---

## Quick path (cómo funciona en 4 pasos)

1. El usuario crea un indicador en el frontend (nombre + definición con filtros).
2. El backend valida los UUIDs contra OpenMRS, guarda la definición como JSONB
   inmutable en PostgreSQL (`indicador_version`).
3. El motor (`engine/`) traduce la definición a SQL parametrizado, lo ejecuta
   contra el MySQL de OpenMRS (solo lectura) y persiste el resultado en
   PostgreSQL (`indicador_resultado`).
4. El frontend consulta los resultados precomputados via `GET /resultados`.

---

## Metamodelo (la abstracción central)

Un indicador responde **dos preguntas independientes**:

| Pregunta | Traducción | Ejemplo |
|----------|-----------|---------|
| **¿Qué quiero contar?** | Tipo de conteo | "sumatoria de consultas" vs "pacientes con 4+ controles" |
| **¿A qué encuentros aplica?** | Filtros | Solo consultas de IRA, en niños <5 años, en enero 2026 |

### Tipos de conteo (solo hay 2)

| Tipo | Qué cuenta | Cuándo usarlo |
|------|-----------|---------------|
| `conteo_atenciones` | Filas de encuentro | "Cuántas veces ocurrió X" |
| `conteo_pacientes` | Pacientes distintos | "Cuántos pacientes cumplieron X" |

### Filtros (5 dimensiones independientes)

| Dimensión | Pydantic model | Qué filtra |
|-----------|---------------|------------|
| **Evento** | `FiltrosEvento` | Tipos de encuentro (por UUID de OpenMRS), mínimo de ocurrencias |
| **Población** | `FiltrosPoblacion` | Rango etario (años/meses/días combinables), sexo (M/F) |
| **Observaciones** | `FiltroObservacion[]` | Conceptos clínicos que DEBEN estar presentes (AND lógico) |
| **Diagnóstico** | `FiltrosDiagnostico` | Códigos CIE-10 y tipo (definitivo/presuntivo) |
| **Período** | `PeriodoIndicador` | mes_actual, mes_anterior, semana_actual, semana_anterior |

### Representación canónica (Pydantic v2)

```python
class DefinicionIndicador(BaseModel):
    tipo: Literal["conteo_atenciones", "conteo_pacientes"]
    periodo: Literal["mes_actual", "mes_anterior", "semana_actual", "semana_anterior"]
    evento: FiltrosEvento | None          # Tipos de encuentro + mínimo ocurrencias
    poblacion: FiltrosPoblacion | None    # Edad + sexo
    observaciones: list[FiltroObservacion] | None  # Conceptos clínicos (AND)
    diagnostico: FiltrosDiagnostico | None # CIE-10 + tipo
```

Se almacena como **JSONB inmutable** en `indicador_version.definicion`. Cada
cambio de definición crea una nueva versión (append-only). La versión anterior
queda intacta — los resultados precomputados de versiones viejas nunca se invalidan.

---

## Arquitectura

```
┌──────────────────────┐     ┌──────────────────────┐
│   React 18 + Vite    │     │   FastAPI (async)     │
│   TypeScript strict  │────▶│   Python 3.11+        │
│   TanStack Query     │     │   SQLAlchemy 2.x      │
│   React Hook Form    │     │   Pydantic v2         │
│   Tailwind CSS       │     │                      │
│   Puerto 5173        │     │   Puerto 8000         │
└──────────────────────┘     └──────┬──────┬────────┘
                                    │      │
                          ┌─────────┘      └─────────┐
                          ▼                          ▼
              ┌──────────────────┐     ┌──────────────────┐
              │  PostgreSQL      │     │  OpenMRS MySQL    │
              │  (indicadores)   │     │  (solo lectura)   │
              │                  │     │                  │
              │  • indicador     │     │  • encounter      │
              │  • version(JSONB)│     │  • obs            │
              │  • resultado     │     │  • patient        │
              │                  │     │  • concept        │
              └──────────────────┘     └──────────────────┘
```

### Stack técnico

| Capa | Tecnología | Detalle |
|------|-----------|---------|
| **Backend** | FastAPI + SQLAlchemy 2.x (async) | Python 3.11+, type hints estrictos |
| **Frontend** | React 18 + Vite + Tailwind | TypeScript strict, TanStack Query, React Hook Form + Zod |
| **App DB** | PostgreSQL | `indicador`, `indicador_version` (JSONB), `indicador_resultado` |
| **Clínica DB** | MySQL (OpenMRS) | Solo lectura. Motor `pymysql` sincrónico |
| **ORM** | SQLAlchemy 2.x declarative | UUID PKs, JSONB, unique constraints |
| **Validación** | Pydantic v2 | Modelos sin efectos secundarios (I/O en capa router) |
| **Migraciones** | Alembic | PostgreSQL schema versionado |

### Capas del backend

```
routers/         ← HTTP (FastAPI). Thin — delega a validators/services.
    │
validators/      ← I/O existence checks (OpenMRS UUID lookup).
    │
schemas/         ← API request/response shapes (separados de DB models).
    │
types/           ← Pydantic metamodel (DefinicionIndicador, filtros).
    │               Cero acoplamiento a ORM — testables en aislamiento.
engine/
    interpreter   ← Traduce DefinicionIndicador → SQL parametrizado
    executor      ← Ejecuta SQL contra MySQL y persiste en PostgreSQL
models/          ← SQLAlchemy ORM (solo DB, sin lógica de negocio)
```

---

## Cómo funciona el motor

### 1. SQL Builder (`interpreter.py`)

Entrada: `DefinicionIndicador` + fechas del período + `concept_map`.

```python
def build_query(definicion, periodo_inicio, periodo_fin, concept_map) -> tuple[str, dict]:
    # Devuelve (sql_string, params_dict) — listo para PyMySQL
```

Según `tipo`:
- **`conteo_atenciones`**: `SELECT COUNT(*) FROM encounter e JOIN patient p ... WHERE ...`
- **`conteo_pacientes`**: `SELECT COUNT(DISTINCT p.patient_id) ... WHERE ... GROUP BY p.patient_id HAVING COUNT(e.encounter_id) >= ?`

Filtros que se traducen a SQL:
- `encounter_type_uuids` → `WHERE e.encounter_type IN :uuids`
- Población (edad) → `WHERE TIMESTAMPDIFF(DAY, p.birthdate, :inicio) BETWEEN :min_dias AND :max_dias`
- Población (sexo) → `WHERE p.gender = :sexo`
- Observaciones → subqueries `EXISTS (SELECT 1 FROM obs WHERE concept_id = :cid AND voided=0)`
- Diagnóstico → JOIN con `encounter_diagnosis` + filtro CIE-10 / tipo
- Período → `WHERE e.encounter_datetime BETWEEN :inicio AND :fin`

**Todo usa parámetros `%(name)s` de PyMySQL. Cero string interpolation.**

### 2. Executor (`executor.py`)

```python
def execute_and_persist(query_sql, params, version_id, inicio, fin) -> list[IndicadorResultado]:
    # 1. Ejecuta SQL contra MySQL (sync engine, solo lectura)
    # 2. Construye ORM instances
    # 3. Persiste en PostgreSQL via async session
    # 4. Transaccional: todo o nada
```

### 3. Disparadores de cálculo

Actualmente el cálculo se dispara manualmente desde el frontend ("Calcular ahora").
El endpoint `POST /resultados/calcular/{id}` orquesta todo: resuelve conceptos,
construye SQL, ejecuta, persiste, y devuelve los resultados.

---

## API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/indicadores/` | Crear indicador + versión 1 |
| `GET` | `/indicadores/` | Listar activos (paginado) |
| `GET` | `/indicadores/{id}` | Detalle con historial de versiones |
| `PUT` | `/indicadores/{id}` | Actualizar metadata (nombre/descripción) |
| `DELETE` | `/indicadores/{id}` | Soft-delete (`activo=false`) |
| `POST` | `/indicadores/{id}/versiones` | Nueva versión inmutable |
| `GET` | `/resultados/{id}` | Resultados precomputados (paginado) |
| `POST` | `/resultados/calcular/{id}` | Ejecutar motor y guardar resultados |
| `GET` | `/conceptos/encounter-types` | Proxy OpenMRS → tipos de encuentro |
| `GET` | `/conceptos/buscar?q=&clase=` | Proxy OpenMRS → búsqueda de conceptos |

**Validación en dos capas:**
- **Formato**: Pydantic (tipos, required fields, ranges) — en `types/`
- **Existencia**: UUID lookup contra OpenMRS — en `validators/openmrs.py`, llamado desde el router
- Si OpenMRS no responde → 502 (`OpenMRS no disponible`)
- Si UUID no existe → 422 con detalle de cuáles fallaron

---

## Frontend

| Página | Ruta | Estado |
|--------|------|--------|
| Lista de indicadores | `/` | ✅ Completo (paginado, crear, eliminar) |
| Detalle + versiones | `/indicadores/:id` | ✅ Completo (tab de definición + tab de resultados) |
| Formulario crear | `/indicadores/nuevo` | ✅ Completo (todos los filtros) |
| Formulario editar metadata | En detalle | ✅ Completo |
| Nueva versión | En detalle | ✅ Completo |
| Calcular ahora | En detalle | ✅ Completo |

### Componentes clave del formulario

- `EncounterTypeSelector` — checkboxes con búsqueda y scroll (55 tipos de OpenMRS)
- `IndicadorForm` — React Hook Form + Zod, dinámico según `mode` (create/edit/version)
- `DefinicionView` — Vista de solo lectura de la definición (formato legible, no JSON crudo)
- `ResultadosView` — Tabla de resultados precomputados con paginación

### Manejo de errores

- `ApiError` con `status` y `detail` tipados
- `ErrorState` / `LoadingState` componentes reutilizables
- `parseApiError()` extrae mensajes de respuestas 422, 409, 502

---

## Estado actual (mayo 2026)

### ✅ Implementado

- [x] Metamodelo completo (`DefinicionIndicador` con los 5 filtros)
- [x] CRUD de indicadores con versionado inmutable (JSONB)
- [x] Validación de UUIDs contra OpenMRS en dos capas (formato + existencia)
- [x] Motor SQL: `conteo_atenciones` y `conteo_pacientes` con todos los filtros
- [x] Proxy HTTP a OpenMRS REST API (encounter types, concept search)
- [x] Frontend completo: CRUD, versionado, cálculo de resultados
- [x] Soft-delete, paginación, manejo de errores
- [x] Tests backend (pytest) y frontend (Vitest + MSW)
- [x] Seed migration con indicador IRA de ejemplo
- [x] Vista Superset (`indicador_resultado_superset`) para BI

### 🔲 Pendiente (próximos pasos)

- [ ] Agrupación de resultados (`por_servicio`, `por_sexo`, `por_edad`)
- [ ] `condicion_temporal` en eventos (`ultimo_en_periodo` vs `cualquiera_en_periodo`)
- [ ] Múltiples eventos (actualmente single-evento)
- [ ] Programación de recálculo automático (cron/scheduler)
- [ ] Filtros de población por `birthdate_estimated`
- [ ] UI de filtros de diagnóstico en el formulario (modelo existe, falta UI)

---

## Convenciones del proyecto

| Área | Regla |
|------|-------|
| **Tipos** | Type hints estrictos (no `Any`). `uuid.UUID` para UUIDs. |
| **I/O** | Modelos Pydantic sin I/O. Validación de existencia en capa router. |
| **SQL** | Siempre parametrizado (`%(name)s`). Nunca string interpolation. |
| **Errores** | 422 (validación), 502 (upstream caído). Body: `{"detail": {...}}`. |
| **Commits** | Conventional commits (`feat:`, `fix:`, `chore:`). Sin atribución AI. |
| **Archivos** | `.agents/`, `.atl/`, `.claude/` SON tracked (NO en .gitignore). |
| **Frontend** | Tailwind para estilos, TanStack Query para datos, Zod para forms. |

---

## Levantar en local

```bash
# Backend (FastAPI + PostgreSQL + OpenMRS MySQL)
cd indicators-back
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload          # → http://localhost:8000

# Frontend (React + Vite)
cd indicators-front
npm install
npm run dev                            # → http://localhost:5173
```

**Variables de entorno** (`.env` en `indicators-back/`):
- `OPENMRS_API_URL` — URL del REST API de OpenMRS (default: `http://localhost/openmrs`)
- `OPENMRS_API_USER` / `OPENMRS_API_PASSWORD` — credenciales Basic Auth
- `INDICADORES_DB_*` — conexión PostgreSQL
- `OPENMRS_DB_*` — conexión MySQL (sync, solo lectura)
