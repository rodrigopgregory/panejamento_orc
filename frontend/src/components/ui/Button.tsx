import React, { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

// Botao do design system Mitra.
//   sm 32px / 13px / raio 10 · md 36px / 13.5px / raio 16 · lg 40px / 14px / raio 16
// Uma acao primaria por tela; o acento (--accent) so aparece nela.
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-[10px]',
  md: 'h-9 px-3.5 text-[13.5px] rounded-xl',
  lg: 'h-10 px-4 text-[14px] rounded-xl',
};

const variantClasses: Record<Variant, string> = {
  primary: 'shadow-sm',
  secondary: 'border shadow-sm',
  danger: 'shadow-sm hover:brightness-110',
  ghost: '',
};

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' },
  secondary: { backgroundColor: 'var(--bg-elevated)', color: 'var(--fg)', borderColor: 'var(--border)' },
  danger: { backgroundColor: 'var(--danger)', color: 'var(--accent-fg)' },
  ghost: { color: 'var(--fg-muted)' },
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`
          inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none
          transition-[background-color,border-color,color,box-shadow,transform] duration-150
          active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          ${variantClasses[variant]}
          ${sizeClasses[size]}
          ${className}
        `}
        style={variantStyles[variant]}
        onMouseEnter={(e) => {
          if (variant === 'primary') e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
          if (variant === 'secondary') {
            e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
            e.currentTarget.style.borderColor = 'var(--border-strong)';
          }
          if (variant === 'ghost') {
            e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
            e.currentTarget.style.color = 'var(--fg)';
          }
        }}
        onMouseLeave={(e) => {
          if (variant === 'primary') e.currentTarget.style.backgroundColor = 'var(--accent)';
          if (variant === 'secondary') {
            e.currentTarget.style.backgroundColor = 'var(--bg-elevated)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }
          if (variant === 'ghost') {
            e.currentTarget.style.backgroundColor = '';
            e.currentTarget.style.color = 'var(--fg-muted)';
          }
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
