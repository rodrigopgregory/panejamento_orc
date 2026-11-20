import type { HTMLAttributes, ReactNode } from 'react';

// Cartao do design system Mitra: superficie elevada, borda de 1px, raio 20px
// e a sombra quase invisivel (--shadow-sm). Nunca cartao dentro de cartao.
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className = '', style, children, ...props }: CardProps) {
  return (
    <div
      className={`cartao ${className}`}
      style={style}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`px-5 py-4 flex items-center justify-between gap-4 ${className}`} style={{ borderBottom: '1px solid var(--border-subtle)' }} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className = '', children, ...props }: CardProps) {
  return (
    <h3 className={`text-[14px] font-medium leading-none ${className}`} style={{ color: 'var(--fg)' }} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = '', children, ...props }: CardProps) {
  return (
    <p className={`mt-1 text-[12.5px] leading-snug ${className}`} style={{ color: 'var(--fg-subtle)' }} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className = '', children, ...props }: CardProps) {
  return (
    <div className={`px-5 py-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

export default Card;
