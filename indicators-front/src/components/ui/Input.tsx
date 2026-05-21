import type { ReactElement, InputHTMLAttributes } from 'react';
import * as React from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref): ReactElement => {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;
