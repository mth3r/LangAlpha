import React, { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { Time } from 'lightweight-charts';
import type { RunStrategyResult } from '../utils/api';
import { useTheme } from '@/contexts/ThemeContext';

interface Props {
  result: RunStrategyResult | null;
  error: string | null;
  isRunning: boolean;
}

function StatCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  );
}

function SignalChart({ result }: { result: RunStrategyResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current || result.signals.length === 0) return;

    const isDark = theme === 'dark';
    const bg = isDark ? '#1a1a2e' : '#ffffff';
    const text = isDark ? '#d1d5db' : '#374151';
    const grid = isDark ? '#2a2a3e' : '#f3f4f6';
    const border = isDark ? '#2a2a3e' : '#e5e7eb';

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      timeScale: { borderColor: border, timeVisible: true },
      rightPriceScale: { borderColor: border },
      width: containerRef.current.clientWidth,
      height: 260,
    });

    const series = chart.addLineSeries({
      color: isDark ? '#60a5fa' : '#2563eb',
      lineWidth: 1,
      priceLineVisible: false,
    });

    // Build line data from signals
    const sorted = [...result.signals].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const lineData = sorted.map((s) => ({
      time: Math.floor(new Date(s.timestamp).getTime() / 1000) as unknown as Time,
      value: s.price,
    }));
    series.setData(lineData);

    // Set markers for buy/sell signals
    const markers = sorted.map((s) => ({
      time: Math.floor(new Date(s.timestamp).getTime() / 1000) as unknown as Time,
      position: s.action === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
      color: s.action === 'buy' ? '#22c55e' : '#ef4444',
      shape: s.action === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
      text: s.action === 'buy' ? 'B' : 'S',
    }));
    series.setMarkers(markers);

    chart.timeScale().fitContent();

    const resizeObs = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObs.observe(containerRef.current);

    return () => {
      resizeObs.disconnect();
      chart.remove();
    };
  }, [result, theme]);

  if (result.signals.length === 0) {
    return <div className="backtest-no-signals">No signals generated.</div>;
  }

  return <div ref={containerRef} className="signal-chart-container" />;
}

export default function BacktestResults({ result, error, isRunning }: Props) {
  if (isRunning) {
    return (
      <section className="backtest-results">
        <div className="backtest-loading">Running backtest…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="backtest-results">
        <div className="strategy-error">{error}</div>
      </section>
    );
  }

  if (!result) return null;

  const { stats } = result;
  const fmtPct = (v: number | null) => (v !== null ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : null);
  const fmtWin = (v: number | null) => (v !== null ? `${v.toFixed(1)}%` : null);

  return (
    <section className="backtest-results">
      <div className="backtest-results-header">
        {result.symbol} · {result.interval}
        <span className="backtest-signal-count">{stats.total_trades} signals</span>
      </div>

      <div className="stats-grid">
        <StatCard label="Total Return" value={fmtPct(stats.total_return_pct)} />
        <StatCard label="Win Rate" value={fmtWin(stats.win_rate)} />
        <StatCard label="Max Drawdown" value={fmtPct(stats.max_drawdown_pct)} />
        <StatCard label="Buy / Sell" value={`${stats.buy_signals} / ${stats.sell_signals}`} />
      </div>

      <SignalChart result={result} />

      {result.ai_commentary && (
        <div className="backtest-commentary">{result.ai_commentary}</div>
      )}

      {result.signals.length > 0 && (
        <div className="signal-table-wrap">
          <table className="signal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {result.signals.slice(0, 50).map((s, i) => (
                <tr key={i} className={s.action === 'buy' ? 'signal-buy' : 'signal-sell'}>
                  <td>{new Date(s.timestamp).toLocaleDateString()}</td>
                  <td className="signal-action">{s.action.toUpperCase()}</td>
                  <td>${s.price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.signals.length > 50 && (
            <div className="signal-table-more">
              Showing 50 of {result.signals.length} signals
            </div>
          )}
        </div>
      )}
    </section>
  );
}
