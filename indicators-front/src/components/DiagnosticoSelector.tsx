import { type ReactElement, useState, useRef, useEffect } from 'react';
import { Controller, type Control, type FieldPath } from 'react-hook-form';
import { useDiagnosticoSearch, useDebounce } from '@/features/indicadores/hooks';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import Input from '@/components/ui/Input';
import type { DiagnosticoOption } from '@/api/types';

// ══════════════════════════════════════════════════════════════════════════
// Container component — wraps react-hook-form Controller
// ══════════════════════════════════════════════════════════════════════════

export interface DiagnosticoSelectorProps<
  TFieldValues extends Record<string, unknown> = Record<string, unknown>,
> {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
}

/**
 * Multi-select diagnosis concept selector for react-hook-form.
 *
 * Stores an array of concept UUIDs in the form field.
 * Selected concepts appear as removable chips below the search input.
 */
export default function DiagnosticoSelector<
  TFieldValues extends Record<string, unknown> = Record<string, unknown>,
>({ control, name }: DiagnosticoSelectorProps<TFieldValues>): ReactElement {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selectedUuids: string[] = Array.isArray(field.value) ? field.value : [];

        const handleSelect = (uuid: string) => {
          if (!selectedUuids.includes(uuid)) {
            field.onChange([...selectedUuids, uuid]);
          }
        };

        const handleRemove = (uuid: string) => {
          field.onChange(selectedUuids.filter((u) => u !== uuid));
        };

        return (
          <DiagnosticoDropdown
            selectedUuids={selectedUuids}
            onSelect={handleSelect}
            onRemove={handleRemove}
          />
        );
      }}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Internal presentational component
// ══════════════════════════════════════════════════════════════════════════

interface DiagnosticoDropdownProps {
  selectedUuids: string[];
  onSelect: (uuid: string) => void;
  onRemove: (uuid: string) => void;
}

function DiagnosticoDropdown({
  selectedUuids,
  onSelect,
  onRemove,
}: DiagnosticoDropdownProps): ReactElement {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(search, 300);
  const { data, isLoading, isError, error } = useDiagnosticoSearch(debouncedQuery);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showDropdown =
    open && debouncedQuery.trim().length >= 2;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setOpen(true);
  };

  const handleInputFocus = () => {
    if (debouncedQuery.trim().length >= 2) {
      setOpen(true);
    }
  };

  const handleSelect = (option: DiagnosticoOption) => {
    onSelect(option.uuid);
    setSearch('');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="space-y-2">
      {/* Search input */}
      <div className="relative">
        <Input
          type="text"
          placeholder="Buscar diagnóstico…"
          value={search}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          aria-label="Buscar diagnóstico"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          role="combobox"
        />
      </div>

      {/* Selected chips */}
      {selectedUuids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedUuids.map((uuid) => (
            <span
              key={uuid}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
            >
              <span className="font-mono">
                {uuid.length > 8 ? `${uuid.slice(0, 8)}…` : uuid}
              </span>
              <button
                type="button"
                onClick={() => onRemove(uuid)}
                className="ml-0.5 rounded-full p-0.5 text-blue-500 hover:bg-blue-200 hover:text-blue-800"
                aria-label={`Quitar ${uuid}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {/* Loading state */}
          {isLoading && (
            <div className="px-3 py-4">
              <LoadingState message="Buscando diagnósticos…" />
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="px-3 py-4">
              <ErrorState
                message={
                  error?.message ?? 'Error al buscar diagnósticos'
                }
              />
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && data && data.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-gray-500">
              Sin resultados para esta búsqueda.
            </p>
          )}

          {/* Result list */}
          {!isLoading &&
            !isError &&
            data &&
            data.length > 0 &&
            data.map((option) => (
              <button
                key={option.uuid}
                type="button"
                role="option"
                aria-selected={selectedUuids.includes(option.uuid)}
                disabled={selectedUuids.includes(option.uuid)}
                onClick={() => handleSelect(option)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none ${
                  selectedUuids.includes(option.uuid)
                    ? 'cursor-default bg-blue-50 text-gray-400'
                    : 'cursor-pointer text-gray-700'
                }`}
              >
                {option.codigo && (
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
                    {option.codigo}
                  </span>
                )}
                <span className="truncate">{option.nombre}</span>
                {selectedUuids.includes(option.uuid) && (
                  <span className="ml-auto shrink-0 text-xs text-gray-400">
                    Seleccionado
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
