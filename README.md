# Indicators

Sistema de indicadores sobre OpenMRS.

Lee datos de encuentros médicos almacenados en OpenMRS (MySQL), los procesa según definiciones configurables, y expone los resultados via API REST para consumo del frontend y herramientas de BI.

## Arquitectura

- **Backend**: FastAPI + SQLAlchemy 2.x (async). Motor de indicadores que genera SQL parametrizado para leer de OpenMRS y guarda resultados en PostgreSQL.
- **Frontend**: React 18 + TypeScript + Vite + Tailwind. SPA con páginas para listar, crear, editar y calcular indicadores.
- **Base de datos app**: PostgreSQL. Almacena definiciones de indicadores, versiones (JSONB inmutables) y resultados pre-computados.
- **Base de datos clínica**: OpenMRS en MySQL (solo lectura). Origen de los datos de encuentros, pacientes y observaciones.


## Metamodelo

Un indicador responde **dos preguntas independientes**:

1. **¿Qué quiero contar?** → define el tipo de conteo
2. **¿A qué encuentros aplica?** → define los filtros

### Tipos de conteo

Solo hay dos. El enunciado del indicador decide cuál usar, no la forma en que está guardado el dato en OpenMRS:

| Tipo | Cuenta | Usar cuando el indicador mide... | Ejemplo MINSA |
|------|--------|----------------------------------|---------------|
| `conteo_atenciones` | Filas de encuentro | "Cuántas veces ocurrió algo" | "sumatoria de casos de IRA tratados" |
| `conteo_pacientes` | Pacientes distintos | "Cuántos pacientes cumplieron algo" | "número de recién nacidos con 4 controles CRED" |

### Filtros

- **Eventos**: tipos de encuentro (por UUID), condición temporal (último en período vs cualquiera), mínimo de ocurrencias.
- **Población**: rango etario (años, meses, días combinables) y sexo.
- **Observaciones**: conceptos clínicos (por UUID) que deben estar presentes como observaciones no anuladas en el encuentro (lógica AND entre conceptos).
- **Diagnóstico**: códigos CIE-10 y tipo de diagnóstico (definitivo/presuntivo). Se usa cuando el indicador mide una **enfermedad diagnosticada** por el clínico (IRA, EDA, anemia).
- **Período**: mes actual, mes anterior, semana actual, semana anterior.
- **Agrupación**: opcional, para desagregar resultados (por servicio, sexo o edad).

#### Regla semántica: `diagnostico` vs `observaciones`

Estos dos filtros responden a preguntas clínicas distintas. **NUNCA** uses ambos para el mismo concepto:

| Filtro | Responde a | Cuándo usarlo |
|--------|-----------|---------------|
| `diagnostico.codigos_cie10` | ¿El paciente fue **diagnosticado** con X? | Enfermedad diagnosticada (anemia, IRA, neumonía) |
| `observaciones[].concepto_uuid` | ¿Se le **realizó** la prueba Y? | Prueba/procedimiento (hemoglobina, VIH, vacuna) |

```json
// Anemia como diagnóstico
{ "diagnostico": { "codigos_cie10": ["D50.0", "D50.8", "D50.9"] } }

// Hemoglobina como prueba
{ "observaciones": [{ "concepto_uuid": "<uuid-hemoglobina>" }] }
```

### Representación

Un indicador se representa con esta estructura (Pydantic v2):

```
IndicadorDefinicion
├── tipo: "conteo_atenciones" | "conteo_pacientes"
├── periodo: "mes_actual" | "mes_anterior" | "semana_actual" | "semana_anterior"
├── agrupacion: "por_servicio" | "por_sexo" | "por_edad" | null
├── poblacion: PoblacionFiltro | null
│   ├── edad_min_anios, edad_max_anios
│   ├── edad_min_meses, edad_max_meses
│   ├── edad_min_dias, edad_max_dias
│   └── sexo: "M" | "F" | null
├── diagnostico: FiltrosDiagnostico | null
│   ├── codigos_cie10: str[]
│   └── tipo_diagnostico: "definitivo" | "presuntivo" | null
├── observaciones: FiltroObservacion[] | null
│   └── concepto_uuid: UUID
└── eventos: EventoFiltro[] (mínimo 1)
    ├── encounter_type_uuids: UUID[]
    ├── minimo_ocurrencias: int (default 1)
    └── condicion_temporal: "ultimo_en_periodo" | "cualquiera_en_periodo" | null
```

## Cómo funciona el motor

1. El usuario crea un indicador via POST `/indicadores`. Se almacena la definición como JSONB en `indicador_version`.
2. El sistema (o el usuario via "Calcular ahora") ejecuta el motor:
   - `interpreter.py` lee la `IndicadorDefinicion` y genera SQL parametrizado.
   - `executor.py` ejecuta ese SQL contra OpenMRS (MySQL sincrónico) y guarda el resultado en PostgreSQL.
3. Los resultados se consultan via GET `/resultados` con paginación y filtros.

## Levantar local

### Requisitos

- Python 3.11+
- Node.js 18+
- PostgreSQL (para la app)
- MySQL con OpenMRS (solo lectura)

### Backend

```bash
cd indicators-back
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Aplicar migraciones
alembic upgrade head

# Iniciar servidor
uvicorn app.main:app --reload
```

El backend expone:
- API REST en `http://localhost:8000`
- Documentación interactiva en `http://localhost:8000/docs` (Swagger UI)

### Frontend

```bash
cd indicators-front
npm install
npm run dev
```

El frontend se levanta en `http://localhost:5173` con proxy al backend.

## Tests

### Backend

```bash
cd indicators-back
pytest
```

### Frontend

```bash
cd indicators-front
npm test
```
