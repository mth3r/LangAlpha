import React, { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';

const INTERVALS = [
  { value: '1d', label: 'Daily' },
  { value: '1w', label: 'Weekly' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '30m', label: '30m' },
];

interface Props {
  onRun: (symbol: string, interval: string, fromDate?: string, toDate?: string) => void;
  isRunning: boolean;
  disabled?: boolean;
}

export default function BacktestRunner({ onRun, isRunning, disabled }: Props) {
  const [symbol, setSymbol] = useState('AAPL');
  const [interval, setInterval] = useState('1d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const handleRun = () => {
    if (!symbol.trim()) return;
    onRun(symbol.trim().toUpperCase(), interval, fromDate || undefined, toDate || undefined);
  };

  return (
    <section className="backtest-runner">
      <div className="backtest-runner-title">Backtest</div>
      <div className="backtest-runner-controls">
        <input
          className="backtest-input backtest-symbol"
          placeholder="Symbol (e.g. AAPL)"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
        />
        <select
          className="backtest-select"
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="backtest-input backtest-date"
          title="From date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <input
          type="date"
          className="backtest-input backtest-date"
          title="To date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
        <button
          className="strategy-btn strategy-btn-primary backtest-run-btn"
          onClick={handleRun}
          disabled={isRunning || disabled || !symbol.trim()}
          title={disabled ? 'Save strategy first to enable backtesting' : 'Run backtest'}
        >
          {isRunning ? (
            <>
              <Loader2 size={14} className="spin" /> Running…
            </>
          ) : (
            <>
              <Play size={14} /> Run
            </>
          )}
        </button>
      </div>
      {disabled && (
        <div className="backtest-hint">Save the strategy to enable backtesting.</div>
      )}
    </section>
  );
}
