import { forwardRef, useCallback } from 'react';
import type { InputHTMLAttributes, ChangeEvent } from 'react';

// Campo de texto do design system Mitra: 36px de altura, raio 12px, 14px de
// corpo. Rotulo 13px/500 em --fg-muted; erro 12px em --danger. O anel duplo de
// foco vem da regra global de :focus-visible no index.css.
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string;
  error?: string;
  onChange?: (value: string) => void;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, onChange, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
      onChange?.(e.target.value);
    }, [onChange]);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-[13px] font-medium" style={{ color: 'var(--fg-muted)' }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          onChange={handleChange}
          className={`controle w-full disabled:cursor-not-allowed ${className}`}
          style={error ? { borderColor: 'var(--danger)' } : undefined}
          {...props}
        />
        {error && <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
