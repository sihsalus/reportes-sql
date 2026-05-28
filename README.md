# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos. Lee datos desde OpenMRS (MySQL, solo lectura) y almacena resultados en PostgreSQL.

## Requisitos

- Python 3.9+
- PostgreSQL 12+
- MySQL 5.7+ (OpenMRS)

## Instalación

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/sihsalus/reportes-sql.git
   cd reportes-sql
   ```

2. **Crear entorno virtual:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # En Windows: venv\Scripts\activate
   ```

3. **Instalar dependencias:**
   ```bash
   pip install -r requirements.txt
   ```

## Configuración

Crear un archivo `.env` en la raíz del proyecto con las variables de entorno:

```env
# PostgreSQL (indicadores database)
INDICADORES_DB_HOST=localhost
INDICADORES_DB_PORT=5432
INDICADORES_DB_NAME=indicators
INDICADORES_DB_USER=postgres
INDICADORES_DB_PASSWORD=your_password

# MySQL (OpenMRS database)
OPENMRS_DB_HOST=localhost
OPENMRS_DB_PORT=3306
OPENMRS_DB_NAME=openmrs
OPENMRS_DB_USER=root
OPENMRS_DB_PASSWORD=your_password
```

## Ejecutar la aplicación

```bash
uvicorn app.main:app --reload
```

La API estará disponible en `http://localhost:8000`

Acceder a la documentación interactiva en `http://localhost:8000/docs`

## Estructura del proyecto

```
.
├── alembic/                 # Migraciones de base de datos
│   └── versions/           # Scripts de migración
├── app/                    # Aplicación FastAPI
│   ├── routers/           # Endpoints de API
│   │   ├── indicadores.py
│   │   ├── resultados.py
│   │   └── conceptos.py
│   ├── models/            # Modelos SQLAlchemy
│   ├── schemas/           # Schemas Pydantic
│   ├── engine/            # Lógica de cálculo
│   ├── types/             # Tipos y definiciones
│   ├── validators/        # Validadores
│   ├── config.py          # Configuración
│   ├── database.py        # Conexiones DB
│   └── main.py            # Punto de entrada
└── tests/                 # Tests unitarios
```

## Migraciones de base de datos

Crear migración:
```bash
alembic revision --autogenerate -m "descripción"
```

Aplicar migraciones:
```bash
alembic upgrade head
```

