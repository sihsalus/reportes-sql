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
 * Controlled diagnosis concept selector for react-hook-form.
 *
 * Renders a search input with debounced query to the backend.
 * On selection, stores only the concept `uuid` in the form field.
 */
export default function DiagnosticoSelector<
  TFieldValues extends Record<string, unknown> = Record<string, unknown>,
>({ control, name }: DiagnosticoSelectorProps<TFieldValues>): ReactElement {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selectedUuid = (field.value as string) || '';

        const handleSelect = (uuid: string) => {
          field.onChange(uuid);
        };

        return (
          <DiagnosticoDropdown
            selectedUuid={selectedUuid}
            onSelect={handleSelect}
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
  selectedUuid: string;
  onSelect: (uuid: string) => void;
}

function DiagnosticoDropdown({
  selectedUuid,
  onSelect,
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
    setSearch(formatLabel(option));
    setOpen(false);
  };

  const selectedOption = data?.find((opt) => opt.uuid === selectedUuid);

  return (
    <div ref={wrapperRef} className="relative">
      {/* Search input */}
      <div className="relative">
        <Input
          type="text"
          placeholder={
            selectedOption
              ? formatLabel(selectedOption)
              : 'Buscar diagnóstico…'
          }
          value={search}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          aria-label="Buscar diagnóstico"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          role="combobox"
        />
      </div>

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
                aria-selected={option.uuid === selectedUuid}
                onClick={() => handleSelect(option)}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                {option.codigo && (
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
                    {option.codigo}
                  </span>
                )}
                <span className="truncate">{option.nombre}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Label formatting ─────────────────────────────────────────────────────

function formatLabel(option: DiagnosticoOption): string {
  if (option.codigo) {
    return `${option.codigo} → ${option.nombre}`;
  }
  return option.nombre;
}
