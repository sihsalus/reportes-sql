import type { ReactElement } from 'react';

export interface SegmentedButtonOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedButtonProps<T extends string> {
  options: SegmentedButtonOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}

export default function SegmentedButton<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedButtonProps<T>): ReactElement {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={[
              'px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
