import type { ReactElement, LabelHTMLAttributes } from 'react';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {}

export default function Label({
  className = '',
  children,
  ...props
}: LabelProps): ReactElement {
  return (
    <label
      className={`block text-sm font-medium text-gray-700 ${className}`}
      {...props}
    >
      {children}
    </label>
  );
}
