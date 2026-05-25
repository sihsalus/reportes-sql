import { type ReactElement, useState, useMemo } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { useEncounterTypes } from '@/features/indicadores/hooks';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import Input from '@/components/ui/Input';
import type { IndicadorFormValues } from '@/features/indicadores/schema';

export interface EncounterTypeSelectorProps {
  control: Control<IndicadorFormValues>;
  name: `evento.encounter_type_uuids`;
}

export default function EncounterTypeSelector({
  control,
  name,
}: EncounterTypeSelectorProps): ReactElement {
  const { data, isLoading, isError, error } = useEncounterTypes();

  if (isLoading) {
    return <LoadingState message="Cargando tipos de encuentro…" />;
  }

  if (isError) {
    return (
      <ErrorState
        message={
          error?.message ?? 'Error al cargar tipos de encuentro'
        }
      />
    );
  }

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selected = new Set(field.value ?? []);

        const toggle = (uuid: string) => {
          const next = new Set(selected);
          if (next.has(uuid)) {
            next.delete(uuid);
          } else {
            next.add(uuid);
          }
          field.onChange(Array.from(next));
        };

        return (
          <EncounterTypeList
            items={data ?? []}
            selected={selected}
            onToggle={toggle}
          />
        );
      }}
    />
  );
}

/**
 * Internal presentational component so search state lives outside the Controller
 * render function and survives re-renders triggered by field.onChange.
 */
interface EncounterTypeListProps {
  items: Array<{ uuid: string; display: string }>;
  selected: ReadonlySet<string>;
  onToggle: (uuid: string) => void;
}

function EncounterTypeList({
  items,
  selected,
  onToggle,
}: EncounterTypeListProps): ReactElement {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((et) =>
      et.display.toLowerCase().includes(q),
    );
  }, [items, search]);

  const selectedCount = selected.size;
  const itemsShown = filtered.length;

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Tipos de encuentro</legend>

      {/* Search + count */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <Input
            type="text"
            placeholder="Buscar tipo de encuentro…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label="Filtrar tipos de encuentro"
          />
        </div>
        {selectedCount > 0 && (
          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {selectedCount} seleccionado{selectedCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Scrollable checkbox list */}
      <div className="max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white p-2">
        {itemsShown === 0 && (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            {search.trim()
              ? 'Sin resultados para este filtro.'
              : 'No hay tipos de encuentro disponibles.'}
          </p>
        )}
        {filtered.map((et) => {
          const isChecked = selected.has(et.uuid);
          return (
            <label
              key={et.uuid}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-blue-50"
            >
              <input
                type="checkbox"
                value={et.uuid}
                checked={isChecked}
                onChange={() => onToggle(et.uuid)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="min-w-0 truncate">{et.display}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
