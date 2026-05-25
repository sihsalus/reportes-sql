import { type ReactElement, useState, useRef, useEffect } from 'react';
import { useController, type Control, type FieldPath } from 'react-hook-form';
import { useLocationSearch, useDebounce } from '@/features/indicadores/hooks';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import Input from '@/components/ui/Input';
import type { LocationOption } from '@/api/types';

// ══════════════════════════════════════════════════════════════════════════
// Container component — uses useController hook at component level
// ══════════════════════════════════════════════════════════════════════════

export interface LocationSelectorProps<
  TFieldValues extends Record<string, unknown> = Record<string, unknown>,
> {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
}

/**
 * Multi-select location (servicio) selector for react-hook-form.
 *
 * Stores an array of location UUIDs in the form field.
 * Selected locations appear as removable chips below the search input.
 *
 * Uses `useController` at component level so hooks never run inside
 * a render callback — compliant with the Rules of Hooks.
 */
export default function LocationSelector<
  TFieldValues extends Record<string, unknown> = Record<string, unknown>,
>({ control, name }: LocationSelectorProps<TFieldValues>): ReactElement {
  const { field } = useController({ control, name });
  const [selectedOptions, setSelectedOptions] = useState<
    Map<string, LocationOption>
  >(new Map());

  const selectedUuids: string[] = Array.isArray(field.value) ? field.value : [];

  const handleSelect = (option: LocationOption) => {
    if (!selectedUuids.includes(option.uuid)) {
      field.onChange([...selectedUuids, option.uuid]);
      setSelectedOptions((prev) => {
        const next = new Map(prev);
        next.set(option.uuid, option);
        return next;
      });
    }
  };

  const handleRemove = (uuid: string) => {
    field.onChange(selectedUuids.filter((u) => u !== uuid));
    setSelectedOptions((prev) => {
      const next = new Map(prev);
      next.delete(uuid);
      return next;
    });
  };

  return (
    <LocationDropdown
      selectedUuids={selectedUuids}
      selectedOptions={selectedOptions}
      onSelect={handleSelect}
      onRemove={handleRemove}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Internal presentational component
// ══════════════════════════════════════════════════════════════════════════

interface LocationDropdownProps {
  selectedUuids: string[];
  selectedOptions: Map<string, LocationOption>;
  onSelect: (option: LocationOption) => void;
  onRemove: (uuid: string) => void;
}

function LocationDropdown({
  selectedUuids,
  selectedOptions,
  onSelect,
  onRemove,
}: LocationDropdownProps): ReactElement {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(search, 300);
  const { data, isLoading, isError, error } = useLocationSearch(debouncedQuery);
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

  const handleDropdownSelect = (option: LocationOption) => {
    onSelect(option);
    setSearch('');
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="w-full min-w-0 space-y-2">
      {/* Search input + dropdown */}
      <div className="relative">
        <Input
          type="text"
          placeholder="Buscar servicio…"
          value={search}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          aria-label="Buscar servicio"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          role="combobox"
        />

        {/* Dropdown */}
        {showDropdown && (
          <div
            role="listbox"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-x-hidden overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
          >
            {/* Loading state */}
            {isLoading && (
              <div className="px-3 py-4">
                <LoadingState message="Buscando servicios…" />
              </div>
            )}

            {/* Error state */}
            {isError && !isLoading && (
              <div className="px-3 py-4">
                <ErrorState
                  message={
                    error?.message ?? 'Error al buscar servicios'
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
                  onClick={() => handleDropdownSelect(option)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none ${
                    selectedUuids.includes(option.uuid)
                      ? 'cursor-default bg-blue-50 text-gray-400'
                      : 'cursor-pointer text-gray-700'
                  }`}
                >
                  <span className="min-w-0 truncate">{option.display}</span>
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

      {/* Selected chips */}
      {selectedUuids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedUuids.map((uuid) => {
            const option = selectedOptions.get(uuid);
            const displayText =
              option?.display ??
              (uuid.length > 8 ? `${uuid.slice(0, 8)}…` : uuid);

            return (
              <span
                key={uuid}
                title={option?.display ?? uuid}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
              >
                <span>{displayText}</span>
                <button
                  type="button"
                  onClick={() => onRemove(uuid)}
                  className="ml-0.5 rounded-full p-0.5 text-blue-500 hover:bg-blue-200 hover:text-blue-800"
                  aria-label={`Quitar ${uuid}`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
