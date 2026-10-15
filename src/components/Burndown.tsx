import { useEffect, useRef, useState } from 'preact/hooks';
import type { Sprint, Task } from '../../shared/types';
import { addDays, daysBetween, formatDate, parseIso } from '../lib/date';
import { t } from '../lib/i18n';
import { statuses } from '../store/data';

const DAY = 86_400_000;

export interface BurndownData {
  unit: 'points' | 'tasks';
  scope: number;
  days: number;
  ideal: number[];
  /** Remaining work at each day boundary up to today (index 0 = sprint start). */
  actual: number[];
  /** Fractional x of "now" if the sprint is in progress, with the current remaining value. */
  now: { x: number; value: number } | null;
}

/** Remaining work per day, counting a task as burned once it reached a completed status. */
export function computeBurndown(sprint: Sprint, tasks: Task[], nowMs = Date.now()): BurndownData {
  const days = daysBetween(sprint.startDate, sprint.endDate) + 1;
  const scoped = tasks.filter((x) => statuses.value[x.statusId]?.category !== 'canceled');
  const usePoints = scoped.some((x) => (x.estimate ?? 0) > 0);
  const weight = (x: Task) => (usePoints ? (x.estimate ?? 0) : 1);
  const scope = scoped.reduce((s, x) => s + weight(x), 0);
  const done = scoped.filter((x) => statuses.value[x.statusId]?.category === 'completed' && x.completedAt);
  const start = parseIso(sprint.startDate).getTime();
  const end = start + days * DAY;
  const until = sprint.state === 'completed' && sprint.completedAt ? Math.min(sprint.completedAt, end) : nowMs;
  const remainingAt = (ms: number) => scope - done.filter((x) => x.completedAt! < ms).reduce((s, x) => s + weight(x), 0);

  const actual: number[] = [];
  for (let i = 0; i <= days; i++) {
    const boundary = start + i * DAY;
    if (boundary > until) break;
    actual.push(remainingAt(boundary));
  }
  const ideal = Array.from({ length: days + 1 }, (_, i) => scope - (scope * i) / days);
  const nowX = (until - start) / DAY;
  const now = until > start && until < end && nowX > actual.length - 1 ? { x: nowX, value: remainingAt(until) } : null;
  return { unit: usePoints ? 'points' : 'tasks', scope, days, ideal, actual, now };
}

function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

export function Burndown({ sprint, tasks }: { sprint: Sprint; tasks: Task[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = computeBurndown(sprint, tasks);
  const height = 180;
  const pad = { top: 12, right: 16, bottom: 24, left: 32 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const yMax = niceMax(data.scope || 1);
  const x = (i: number) => pad.left + (i / data.days) * w;
  const y = (v: number) => pad.top + h - (v / yMax) * h;
  const ticks = [0, yMax / 2, yMax];
  const unit = (v: number) => (data.unit === 'points' ? t('common.pointsShort', { count: Math.round(v * 10) / 10 }) : t('common.tasks', { count: Math.round(v) }));

  const actualPts = data.actual.map((v, i) => [x(i), y(v)] as const);
  if (data.now) actualPts.push([x(data.now.x), y(data.now.value)]);
  const actualPath = actualPts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const areaPath = actualPts.length > 1 ? `${actualPath}L${actualPts[actualPts.length - 1][0].toFixed(1)},${y(0)}L${x(0)},${y(0)}Z` : '';
  const last = actualPts[actualPts.length - 1];
  const lastValue = data.now ? data.now.value : data.actual[data.actual.length - 1];

  const xTicks = data.days <= 7 ? Array.from({ length: data.days + 1 }, (_, i) => i) : [0, Math.round(data.days / 2), data.days];

  const onMove = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - pad.left) / w) * data.days);
    setHover(Math.max(0, Math.min(data.days, i)));
  };

  const hoverActual = hover !== null ? data.actual[hover] : undefined;

  return (
    <figure class="burndown" ref={wrap}>
      <figcaption class="chart-legend">
        <span class="legend-key">
          <span class="line-key actual" />
          {t('burndown.remaining')}
        </span>
        <span class="legend-key">
          <span class="line-key ideal" />
          {t('burndown.ideal')}
        </span>
        <span class="grow" />
        <span class="muted">{t('burndown.scope', { value: unit(data.scope) })}</span>
      </figcaption>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t('burndown.aria', { remaining: unit(lastValue ?? data.scope), scope: unit(data.scope) })}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line class="grid" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            <text class="tick" x={pad.left - 6} y={y(v) + 3.5} text-anchor="end">
              {Math.round(v * 10) / 10}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} class="tick" x={x(i)} y={height - 6} text-anchor={i === 0 ? 'start' : i === data.days ? 'end' : 'middle'}>
            {formatDate(i < data.days ? addDays(sprint.startDate, i) : sprint.endDate)}
          </text>
        ))}
        <line class="ideal" x1={x(0)} y1={y(data.scope)} x2={x(data.days)} y2={y(0)} />
        {areaPath && <path class="area" d={areaPath} />}
        {actualPts.length > 1 && <path class="actual" d={actualPath} />}
        {hover !== null && (
          <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} />
        )}
        {hover !== null && hoverActual !== undefined && <circle class="dot" cx={x(hover)} cy={y(hoverActual)} r={4} />}
        {last && hover === null && <circle class="dot" cx={last[0]} cy={last[1]} r={4} />}
      </svg>
      {hover !== null && (
        <div class="chart-tooltip" style={{ left: `${Math.min(Math.max(x(hover), 70), width - 70)}px` }}>
          <div class="tooltip-date">{formatDate(addDays(sprint.startDate, Math.min(hover, data.days - 1)))}</div>
          {hoverActual !== undefined && (
            <div class="tooltip-row">
              <span class="line-key actual" />
              <strong>{unit(hoverActual)}</strong>
              <span class="muted">{t('burndown.remaining')}</span>
            </div>
          )}
          <div class="tooltip-row">
            <span class="line-key ideal" />
            <strong>{unit(data.ideal[hover])}</strong>
            <span class="muted">{t('burndown.ideal')}</span>
          </div>
        </div>
      )}
      <table class="sr-only">
        <caption>{t('burndown.remaining')}</caption>
        <tbody>
          {data.actual.map((v, i) => (
            <tr key={i}>
              <th>{formatDate(addDays(sprint.startDate, i))}</th>
              <td>{unit(v)}</td>
              <td>{unit(data.ideal[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
