import type { ReactElement, SelectHTMLAttributes } from 'react';
import * as React from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, ...props }, ref): ReactElement => {
    return (
      <select
        ref={ref}
        className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';

export default Select;
