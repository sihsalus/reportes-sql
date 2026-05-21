import type { ReactElement, TextareaHTMLAttributes } from 'react';
import * as React from 'react';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref): ReactElement => {
    return (
      <textarea
        ref={ref}
        className={`w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';

export default Textarea;
