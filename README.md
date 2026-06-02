# Motor de Indicadores SIH.SALUS

Microservicio para definición, versionado y cálculo de indicadores clínicos. Lee datos desde OpenMRS (MySQL, solo lectura) y almacena resultados en PostgreSQL.

## Requisitos

- Node.js 22+
- PostgreSQL 12+
- MySQL 5.7+ (OpenMRS)

## Instalación

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/sihsalus/reportes-sql.git
   cd reportes-sql
   ```

2. **Instalar dependencias:**
   ```bash
   pnpm install --frozen-lockfile
   ```

3. **Compilar TypeScript:**
   ```bash
   pnpm build
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

# Application
PORT=8000
```

## Ejecutar la aplicación

### Desarrollo (con hot reload)
```bash
pnpm dev
```

### Producción
```bash
pnpm build && pnpm start
```

La API estará disponible en `http://localhost:8000`.

Endpoints principales:
- `GET /health` — health check
- `GET /indicadores` — listar indicadores
- `GET /resultados` — consultar resultados
- `GET /conceptos` — buscar conceptos

## Estructura del proyecto

```
.
├── src/                     # Aplicación Express TypeScript
│   ├── config/             # Configuración y variables de entorno
│   ├── database/           # Conexiones PostgreSQL (Sequelize) y MySQL
│   ├── engine/             # Lógica de cálculo de indicadores
│   ├── models/             # Modelos Sequelize
│   ├── routers/            # Endpoints de API (Express routers)
│   │   ├── indicadores.ts
│   │   ├── resultados.ts
│   │   └── conceptos.ts
│   ├── types/              # Tipos y definiciones Zod
│   ├── validators/         # Validadores Zod
│   └── main.ts             # Punto de entrada Express
├── dist/                   # Código compilado (tsc output)
├── tests/                  # Tests unitarios e integración (Jest)
├── docker-compose.yml      # Stack Docker: app + PostgreSQL
├── Dockerfile              # Imagen Node.js multi-stage
└── package.json            # Dependencias y scripts
```

## Tests

```bash
# Ejecutar todos los tests
pnpm test

# Modo watch
pnpm test:watch

# Con cobertura
pnpm test:coverage
```

## Docker

```bash
docker compose up -d
```

La API corre en `http://localhost:8000`, PostgreSQL en `localhost:5433`.
