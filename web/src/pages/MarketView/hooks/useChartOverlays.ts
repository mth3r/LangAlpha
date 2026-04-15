import { useEffect, type RefObject } from 'react';
import type { ISeriesApi, Time } from 'lightweight-charts';
import type { ChartDataPoint } from '@/types/market';

interface EarningsEntry {
  date?: string;
  fiscalDateEnding?: string;
  actualEarningResult?: number;
  estimatedEarning?: number;
  [key: string]: unknown;
}

interface GradeEntry {
  date?: string;
  action?: string;
  [key: string]: unknown;
}

interface OverlayData {
  grades?: GradeEntry[];
  [key: string]: unknown;
}

interface OverlayVisibility {
  earnings?: boolean;
  grades?: boolean;
  [key: string]: boolean | undefined;
}

export interface SignalMarker {
  signal: string;
}

const SIGNAL_MARKER_CONFIG: Record<string, {
  position: 'aboveBar' | 'belowBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  color: string;
  text: string;
}> = {
  'Strong Buy': { position: 'belowBar', shape: 'arrowUp',   color: '#10b981', text: 'Strong Buy' },
  'Buy':        { position: 'belowBar', shape: 'arrowUp',   color: '#22c55e', text: 'Buy' },
  'Hold':       { position: 'aboveBar', shape: 'circle',    color: '#f59e0b', text: 'Hold' },
  'Sell':       { position: 'aboveBar', shape: 'arrowDown', color: '#f97316', text: 'Sell' },
  'Strong Sell':{ position: 'aboveBar', shape: 'arrowDown', color: '#ef4444', text: 'Strong Sell' },
  'BUY':        { position: 'belowBar', shape: 'arrowUp',   color: '#10b981', text: 'BUY' },
  'SELL':       { position: 'aboveBar', shape: 'arrowDown', color: '#ef4444', text: 'SELL' },
  'NEUTRAL':    { position: 'aboveBar', shape: 'circle',    color: '#6b7280', text: 'NEUTRAL' },
};

/**
 * Binary search to find the nearest chart bar time for a given date string.
 * Returns the closest time that exists in chartData.
 */
function snapToNearestBar(chartData: ChartDataPoint[], dateStr: string): number | null {
  if (!chartData || chartData.length === 0) return null;

  // Convert date string to unix timestamp (seconds)
  const target = Math.floor(new Date(dateStr).getTime() / 1000);
  if (isNaN(target)) return null;

  let lo = 0;
  let hi = chartData.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chartData[mid].time < target) lo = mid + 1;
    else hi = mid;
  }

  // Check neighbours for closest match
  if (lo > 0) {
    const diffLo = Math.abs(chartData[lo].time - target);
    const diffPrev = Math.abs(chartData[lo - 1].time - target);
    if (diffPrev < diffLo) lo = lo - 1;
  }

  return chartData[lo].time;
}

/**
 * Manages series markers on the candlestick series.
 * Combines earnings surprises, analyst grade changes, and an optional signal marker.
 */
export function useChartOverlays(
  candlestickSeriesRef: RefObject<ISeriesApi<'Candlestick'> | null>,
  chartData: ChartDataPoint[] | null,
  earningsData: EarningsEntry[] | null,
  overlayData: OverlayData | null,
  overlayVisibility: OverlayVisibility | null,
  symbol: string | null,
  signalMarker?: SignalMarker | null,
): void {
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || !chartData || chartData.length === 0) {
      if (series) {
        try { series.setMarkers([]); } catch (_) { /* series may be disposed */ }
      }
      return;
    }

    const markers: Array<{ time: Time; position: 'aboveBar' | 'belowBar'; shape: 'arrowUp' | 'arrowDown' | 'circle'; color: string; text: string; size?: number }> = [];

    // Earnings markers
    if (overlayVisibility?.earnings && earningsData && Array.isArray(earningsData)) {
      earningsData.forEach((e: EarningsEntry) => {
        const date = e.date || e.fiscalDateEnding;
        if (!date) return;
        const time = snapToNearestBar(chartData, date);
        if (!time) return;

        const isBeat = e.actualEarningResult != null && e.estimatedEarning != null
          ? e.actualEarningResult >= e.estimatedEarning
          : true;

        markers.push({
          time: time as Time,
          position: isBeat ? 'belowBar' : 'aboveBar',
          shape: isBeat ? 'arrowUp' : 'arrowDown',
          color: isBeat ? '#10b981' : '#ef4444',
          text: 'E',
        });
      });
    }

    // Grade change markers
    if (overlayVisibility?.grades && overlayData?.grades && Array.isArray(overlayData.grades)) {
      overlayData.grades.forEach((g: GradeEntry) => {
        const date = g.date;
        if (!date) return;
        const time = snapToNearestBar(chartData, date);
        if (!time) return;

        const isUpgrade = g.action === 'upgrade' || g.action === 'Upgrade';
        markers.push({
          time: time as Time,
          position: isUpgrade ? 'belowBar' : 'aboveBar',
          shape: isUpgrade ? 'arrowUp' : 'arrowDown',
          color: isUpgrade ? '#22d3ee' : '#f87171',
          text: isUpgrade ? '\u2191' : '\u2193',
        });
      });
    }

    // Signal marker — pinned at the latest bar
    if (signalMarker) {
      const cfg = SIGNAL_MARKER_CONFIG[signalMarker.signal];
      if (cfg) {
        const latestTime = chartData[chartData.length - 1].time as Time;
        markers.push({
          time: latestTime,
          position: cfg.position,
          shape: cfg.shape,
          color: cfg.color,
          text: cfg.text,
          size: 2,
        });
      }
    }

    // Sort markers by time (required by lightweight-charts)
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    try {
      series.setMarkers(markers);
    } catch (_) {
      /* series may be disposed */
    }

    return () => {
      if (series) {
        try { series.setMarkers([]); } catch (_) { /* already cleaned */ }
      }
    };
  }, [candlestickSeriesRef, chartData, earningsData, overlayData, overlayVisibility, symbol, signalMarker]);
}
