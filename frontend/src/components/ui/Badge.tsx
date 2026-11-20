// Badge do design system Mitra: sem borda, rounded-full, 22px de altura,
// 12px/500, fundo *-soft e texto na cor cheia. O dot opcional tem 6px.
interface BadgeProps {
  variant: 'success' | 'danger' | 'info' | 'warning' | 'blue' | 'neutral' | 'accent';
  children: React.ReactNode;
  dot?: boolean;
}

const TOKENS: Record<BadgeProps['variant'], { bg: string; fg: string; dot: string }> = {
  success: { bg: 'var(--success-soft)', fg: 'var(--success)', dot: 'var(--success)' },
  danger:  { bg: 'var(--danger-soft)',  fg: 'var(--danger)',  dot: 'var(--danger)' },
  info:    { bg: 'var(--info-soft)',    fg: 'var(--info)',    dot: 'var(--info)' },
  blue:    { bg: 'var(--info-soft)',    fg: 'var(--info)',    dot: 'var(--info)' },
  warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)', dot: 'var(--warning)' },
  accent:  { bg: 'var(--accent-soft)',  fg: 'var(--accent)',  dot: 'var(--accent)' },
  neutral: { bg: 'var(--surface-muted)', fg: 'var(--fg-muted)', dot: 'var(--fg-subtle)' },
};

export default function Badge({ variant, children, dot = false }: BadgeProps) {
  const t = TOKENS[variant] || TOKENS.neutral;
  return (
    <span
      className="inline-flex items-center gap-1.5 h-[22px] px-2 text-[12px] font-medium rounded-full whitespace-nowrap"
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.dot }} />}
      {children}
    </span>
  );
}
