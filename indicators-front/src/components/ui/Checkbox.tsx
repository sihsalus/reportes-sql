import type { ReactElement, InputHTMLAttributes } from 'react';

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export default function Checkbox({
  label,
  className = '',
  ...props
}: CheckboxProps): ReactElement {
  return (
    <label className={`flex items-center gap-2 text-sm text-gray-700 ${className}`}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
