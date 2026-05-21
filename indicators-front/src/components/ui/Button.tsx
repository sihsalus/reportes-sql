import type { ReactElement, ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg';
}

export default function Button({
  variant = 'default',
  size = 'default',
  className = '',
  children,
  ...props
}: ButtonProps): ReactElement {
  const base =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

  const variants: Record<string, string> = {
    default: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    outline:
      'border border-gray-300 bg-transparent text-gray-700 hover:bg-gray-50 focus:ring-gray-500',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
    destructive:
      'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  };

  const sizes: Record<string, string> = {
    default: 'px-4 py-2 text-sm',
    sm: 'px-3 py-1.5 text-xs',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
