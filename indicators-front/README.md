# Indicators Frontend

Frontend SPA para crear/versionar indicadores y consultar resultados.

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS
- React Hook Form + Zod
- TanStack Query
- Vitest + Testing Library

## Scripts

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run lint
npm test
```

## Estructura principal

- `src/pages/`: pantallas de navegación.
- `src/components/`: componentes UI y formularios.
- `src/features/indicadores/`: hooks, schema y parsing de definiciones.
- `src/api/`: cliente HTTP tipado y tipos de request/response.

## Filtro de edad (UI actual)

La UI de población usa dos filas:

- `Edad mínima`: años, meses, días
- `Edad máxima`: años, meses, días

Antes de enviar, convierte al payload canónico del backend:

- mínimo -> `min_meses` o `min_dias`
- máximo -> `max_meses_excl` o `max_dias`
- `0/0/0` en una fila => sin filtro para ese límite.

> El backend/engine no cambian: solo cambia la forma de captura en UI.
