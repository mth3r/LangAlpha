import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { useTheme } from '@/contexts/ThemeContext';
import { getChartTheme } from '../../MarketView/utils/chartConstants';
import { getPortfolioPerformance } from '../../Dashboard/utils/api';
import type { PortfolioPerformancePeriod } from '../../Dashboard/utils/api';

const PERIODS: { key: PortfolioPerformancePeriod; label: string }[] = [
  { key: '1D', label: '1D' },
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '3Y', label: '3Y' },
  { key: 'ALL', label: 'All' },
];

interface PortfolioPerformanceChartProps {
  period: PortfolioPerformancePeriod;
  onPeriodChange: (p: PortfolioPerformancePeriod) => void;
}

export default function PortfolioPerformanceChart({
  period,
  onPeriodChange,
}: PortfolioPerformanceChartProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<SeriesType>[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['portfolioPerformance', period],
    queryFn: () => getPortfolioPerformance(period),
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });

  // Create chart once on mount; recreate when theme changes
  useEffect(() => {
    if (!containerRef.current) return;
    const colors = getChartTheme(theme);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: colors.text,
        fontFamily: "'Inter', 'system-ui', sans-serif",
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, timeVisible: true },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    chartRef.current = chart;
    seriesRef.current = [];

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      seriesRef.current = [];
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  // Update data series whenever data or theme changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove previous series
    for (const s of seriesRef.current) {
      try { chart.removeSeries(s); } catch (_) { /* ignore */ }
    }
    seriesRef.current = [];

    if (!data || !data.dates.length) return;

    const colors = getChartTheme(theme);
    const firstVal = data.values[0] ?? 0;
    const lastVal = data.values[data.values.length - 1] ?? 0;
    const isGain = lastVal >= firstVal;
    const lineColor = isGain ? colors.upColor : colors.downColor;
    const fillColor = isGain ? colors.baselineUpFill1 : colors.baselineDownFill1;

    const areaSeries = chart.addAreaSeries({
      lineColor,
      topColor: fillColor,
      bottomColor: 'transparent',
      lineWidth: 2,
    });

    const valueData = data.dates.map((d, i) => ({
      time: d as `${number}-${number}-${number}`,
      value: data.values[i],
    }));
    areaSeries.setData(valueData);
    seriesRef.current.push(areaSeries);

    if (data.cost_basis > 0) {
      const costSeries = chart.addLineSeries({
        color: colors.text,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        title: 'Cost Basis',
      });
      const costData = data.dates.map((d) => ({
        time: d as `${number}-${number}-${number}`,
        value: data.cost_basis,
      }));
      costSeries.setData(costData);
      seriesRef.current.push(costSeries);
    }

    chart.timeScale().fitContent();
  }, [data, theme]);

  return (
    <div className="dashboard-glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Portfolio Performance
        </span>
        <div className="flex gap-0.5 rounded-lg p-1" style={{ backgroundColor: 'var(--color-bg-tag)' }}>
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onPeriodChange(key)}
              className="px-2.5 py-1 text-xs font-medium rounded-md transition-all"
              style={{
                backgroundColor: period === key ? 'var(--color-bg-elevated)' : 'transparent',
                color: period === key ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: '280px', position: 'relative' }}>
        {isLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: 'var(--color-text-secondary)', zIndex: 1, pointerEvents: 'none' }}
          >
            Loading…
          </div>
        )}
        {!isLoading && (!data || !data.dates.length) && (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: 'var(--color-text-secondary)', zIndex: 1, pointerEvents: 'none' }}
          >
            No performance data for this period.
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
