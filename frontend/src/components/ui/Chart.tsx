import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '../../lib/utils';

// ─── Chart Colors ─────────────────────────────────────────────

// Series do design system Mitra (--chart-1..8). Ficam como literais porque o
// Recharts entrega estas cores em ATRIBUTO de SVG (fill/stroke), onde var()
// nao e' garantido — os valores sao os mesmos dos tokens do tema claro.
export const CHART_COLORS = {
  primary: '#7839ee',    // --chart-1 (violeta)
  secondary: '#28a7f8',  // --chart-2 (azul claro)
  accent: '#1d9d6c',     // --chart-3 (verde)
  warning: '#c98a16',    // --chart-4 (ambar)
  pink: '#d4327f',       // --chart-5 (rosa)
  blue: '#5577f6',       // --chart-6 (azul)
  danger: '#d4322c',     // --chart-7 (vermelho)
  teal: '#0d9488',       // --chart-8 (teal)
} as const;

export const CHART_SEQUENCE = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.accent,
  CHART_COLORS.warning,
  CHART_COLORS.pink,
  CHART_COLORS.blue,
  CHART_COLORS.danger,
  CHART_COLORS.teal,
];

// ─── ChartConfig (shadcn) ─────────────────────────────────────

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<'light' | 'dark', string> }
  );
};

// ─── Context (shadcn) ─────────────────────────────────────────

type ChartContextProps = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

// ─── ChartStyle (shadcn) ──────────────────────────────────────

const THEMES = { light: '', dark: '.dark' } as const;

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(
    ([, cfg]) => cfg.theme || cfg.color,
  );

  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .filter(Boolean)
  .join('\n')}
}
`,
          )
          .join('\n'),
      }}
    />
  );
}

// ─── ChartContainer (shadcn) ──────────────────────────────────

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          'flex justify-center text-xs w-full h-full',
          "[&_.recharts-cartesian-axis-tick_text]:fill-slate-500",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-slate-200/50",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-slate-200",
          "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-slate-200",
          "[&_.recharts-radial-bar-background-sector]:fill-slate-100",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-slate-100",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-slate-200",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-hidden",
          "[&_.recharts-sector]:outline-hidden",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

// ─── ChartTooltip (shadcn) ────────────────────────────────────

export const ChartTooltip = RechartsPrimitive.Tooltip;

// ─── ChartTooltipContent (shadcn + pt-BR) ─────────────────────

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: any[];
  className?: string;
  indicator?: 'line' | 'dot' | 'dashed';
  hideLabel?: boolean;
  hideIndicator?: boolean;
  label?: any;
  labelFormatter?: (label: any, payload: any[]) => React.ReactNode;
  labelClassName?: string;
  formatter?: (value: any, name: any, item: any, index: number, payload: any) => React.ReactNode;
  color?: string;
  nameKey?: string;
  labelKey?: string;
  valueFormatter?: (value: number) => string;
  prefix?: string;
}

export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  valueFormatter,
  prefix,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;

    const [item] = payload;
    const key = `${labelKey || item?.dataKey || item?.name || 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === 'string'
        ? config[label as keyof typeof config]?.label || label
        : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn('font-medium', labelClassName)}>
          {labelFormatter(value, payload)}
        </div>
      );
    }

    if (!value) return null;
    return <div className={cn('font-medium', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  const formatValue = (v: unknown) => {
    const num = Number(v);
    if (valueFormatter) return valueFormatter(num);
    if (prefix) return `${prefix} ${num.toLocaleString('pt-BR')}`;
    return typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v ?? '');
  };

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== 'none')
          .map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color || item.payload.fill || item.color;

            return (
              <div
                key={item.dataKey}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-slate-500',
                  indicator === 'dot' && 'items-center',
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            'shrink-0 rounded-[2px]',
                            indicator === 'dot' && 'h-2.5 w-2.5',
                            indicator === 'line' && 'w-1',
                            indicator === 'dashed' &&
                              'w-0 border-[1.5px] border-dashed bg-transparent',
                            nestLabel && indicator === 'dashed' && 'my-0.5',
                          )}
                          style={{
                            backgroundColor:
                              indicator !== 'dashed' ? indicatorColor : undefined,
                            borderColor: indicatorColor,
                          }}
                        />
                      )
                    )}
                    <div
                      className={cn(
                        'flex flex-1 justify-between leading-none',
                        nestLabel ? 'items-end' : 'items-center',
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-slate-500">
                          {itemConfig?.label || item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        <span className="font-mono font-medium tabular-nums text-slate-900 ml-auto pl-2">
                          {formatValue(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ─── ChartLegend (shadcn) ─────────────────────────────────────

export const ChartLegend = RechartsPrimitive.Legend;

export function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: {
  className?: string;
  hideIcon?: boolean;
  payload?: any[];
  verticalAlign?: 'top' | 'bottom';
  nameKey?: string;
}) {
  const { config } = useChart();

  if (!payload?.length) return null;

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== 'none')
        .map((item) => {
          const key = `${nameKey || item.dataKey || 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={item.value}
              className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-slate-500"
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
              )}
              <span className="text-xs text-slate-600">
                {itemConfig?.label || item.value}
              </span>
            </div>
          );
        })}
    </div>
  );
}

// ─── Helper: getPayloadConfigFromPayload (shadcn) ─────────────

function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string,
) {
  if (typeof payload !== 'object' || payload === null) return undefined;

  const payloadPayload =
    'payload' in payload &&
    typeof payload.payload === 'object' &&
    payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === 'string'
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === 'string'
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string;
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config];
}

// ─── ValueLabel ───────────────────────────────────────────────

interface ValueLabelProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
  formatter?: (v: number) => string;
  prefix?: string;
  position?: 'auto' | 'inside' | 'outside' | 'top' | 'bottom' | 'center' | 'left' | 'right';
  orientation?: 'vertical' | 'horizontal';
  fill?: string;
  fontSize?: number;
}

export function ValueLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
  formatter,
  prefix,
  position = 'auto',
  orientation = 'vertical',
  fill = '#475569',
  fontSize = 11,
}: ValueLabelProps) {
  if (value == null || value === 0) return null;

  const displayValue = formatter
    ? formatter(value)
    : prefix
      ? `${prefix} ${formatMarkerValue(value)}`
      : formatMarkerValue(value);

  const isNegative = value < 0;
  const isHorizontal = orientation === 'horizontal';

  let textX: number;
  let textY: number;
  let textAnchor: 'start' | 'middle' | 'end' = 'middle';
  let dominantBaseline: 'auto' | 'middle' | 'hanging' | 'text-after-edge' = 'auto';

  const resolvedPos = position === 'auto'
    ? (isHorizontal ? 'outside' : 'top')
    : position;

  if (isHorizontal) {
    textY = y + height / 2;
    dominantBaseline = 'middle';

    switch (resolvedPos) {
      case 'inside':
      case 'center':
        textX = x + width / 2;
        textAnchor = 'middle';
        break;
      case 'outside':
      case 'right':
        textX = isNegative ? x - 4 : x + width + 4;
        textAnchor = isNegative ? 'end' : 'start';
        break;
      case 'left':
        textX = isNegative ? x + width + 4 : x - 4;
        textAnchor = isNegative ? 'start' : 'end';
        break;
      default:
        textX = x + width + 4;
        textAnchor = 'start';
    }
  } else {
    textX = x + width / 2;
    textAnchor = 'middle';

    switch (resolvedPos) {
      case 'inside':
      case 'center':
        textY = y + height / 2;
        dominantBaseline = 'middle';
        break;
      case 'outside':
      case 'top':
        textY = isNegative ? y + height + 14 : y - 6;
        break;
      case 'bottom':
        textY = isNegative ? y - 6 : y + height + 14;
        break;
      default:
        textY = isNegative ? y + height + 14 : y - 6;
    }
  }

  return (
    <text
      x={textX}
      y={textY}
      textAnchor={textAnchor}
      dominantBaseline={dominantBaseline}
      fill={fill}
      fontSize={fontSize}
      fontWeight={500}
    >
      {displayValue}
    </text>
  );
}

// ─── AxisBandCursor ───────────────────────────────────────────

interface AxisBandCursorProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  opacity?: number;
}

export function AxisBandCursor({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  fill = '#f1f5f9',
  opacity = 1,
}: AxisBandCursorProps) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      fillOpacity={opacity}
      rx={4}
    />
  );
}

// ─── Utility: formatMarkerValue ───────────────────────────────

export function formatMarkerValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString('pt-BR');
}

// ─── Re-exports from recharts ─────────────────────────────────

export const ComposedChart = RechartsPrimitive.ComposedChart;
export const RechartsBar = RechartsPrimitive.Bar;
export const RechartsLine = RechartsPrimitive.Line;
export const RechartsArea = RechartsPrimitive.Area;
export const XAxis = RechartsPrimitive.XAxis;
export const YAxis = RechartsPrimitive.YAxis;
export const CartesianGrid = RechartsPrimitive.CartesianGrid;
export const ReferenceLine = RechartsPrimitive.ReferenceLine;
export const Brush = RechartsPrimitive.Brush;
export const BarChart = RechartsPrimitive.BarChart;
export const LineChart = RechartsPrimitive.LineChart;
export const AreaChart = RechartsPrimitive.AreaChart;
export const PieChart = RechartsPrimitive.PieChart;
export const Pie = RechartsPrimitive.Pie;
export const Cell = RechartsPrimitive.Cell;
export const ResponsiveContainer = RechartsPrimitive.ResponsiveContainer;
export const Tooltip = RechartsPrimitive.Tooltip;
export const Legend = RechartsPrimitive.Legend;

// Backward compat alias
export const CustomLegend = ChartLegendContent;
