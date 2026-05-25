# Indicators

Sistema de indicadores clínicos sobre OpenMRS.

## Arquitectura

- `indicators-back/`: API + motor SQL de indicadores.
- `indicators-front/`: SPA (React + TypeScript + Vite + Tailwind).
- OpenMRS MySQL: fuente clínica de solo lectura.
- PostgreSQL: almacenamiento de metadatos y resultados.

## Qué hace el sistema

Permite definir indicadores clínicos, calcularlos sobre datos de OpenMRS y consultar resultados por API/UI.

En términos funcionales:

- Define reglas de conteo (atenciones o pacientes).
- Aplica filtros clínicos y demográficos.
- Ejecuta cálculo en backend con SQL parametrizado.
- Guarda resultados para consulta histórica.

## Modelo de dominio (alto nivel)

Cada indicador tiene:

- `tipo`: `conteo_atenciones` | `conteo_pacientes`
- `periodo`
- `poblacion` (edad, sexo)
- `evento` (servicio, mínimo de ocurrencias, filtros clínicos)

Para detalles exactos del metamodelo, ver `indicators-back/app/types/definicion.py`.

## API (alto nivel)

- `POST /indicadores`: crea indicador/version.
- `GET /indicadores`: lista indicadores.
- `POST /indicadores/{id}/calcular`: ejecuta cálculo.
- `GET /resultados`: consulta resultados paginados.

Documentación interactiva: `http://localhost:8000/docs`.

## Levantar local

### Requisitos

- Python 3.11+
- Node.js 18+
- PostgreSQL
- OpenMRS MySQL (solo lectura)

### Backend

```bash
cd indicators-back
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

### Frontend

```bash
cd indicators-front
npm install
npm run dev
```

## Estructura del repo

- `indicators-back/` backend
- `indicators-front/` frontend