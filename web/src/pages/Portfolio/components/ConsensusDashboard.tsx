import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface TickerResult {
  symbol: string;
  signals: Record<string, string>;
  consensus: string;
  latest_close?: number | null;
  error?: string | null;
}

interface ConsensusDashboardProps {
  results: TickerResult[];
  screenerIds: string[];
  requireUnanimous: boolean;
  onSymbolClick?: (symbol: string, signal: string) => void;
}

const SIGNAL_CONFIG: Record<string, {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  label: string;
}> = {
  BUY:     { icon: TrendingUp,   color: '#22c55e', label: 'BUY' },
  SELL:    { icon: TrendingDown, color: '#ef4444', label: 'SELL' },
  NEUTRAL: { icon: Minus,        color: '#6b7280', label: 'NEUTRAL' },
};

function SignalBadge({ signal, symbol, onClick }: { signal: string; symbol: string; onClick?: (symbol: string, signal: string) => void }) {
  const cfg = SIGNAL_CONFIG[signal];
  if (!cfg) {
    return <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>;
  }
  const Icon = cfg.icon;
  return (
    <button
      title={cfg.label}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(symbol, signal); } : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 5,
        backgroundColor: `${cfg.color}18`,
        border: `1px solid ${cfg.color}44`,
        color: cfg.color,
        fontSize: 11,
        fontWeight: 600,
        cursor: onClick ? 'pointer' : 'default',
        lineHeight: 1,
      }}
    >
      <Icon size={11} />
      <span>{cfg.label}</span>
    </button>
  );
}

export default function ConsensusDashboard({ results, screenerIds, requireUnanimous, onSymbolClick }: ConsensusDashboardProps) {
  const actionList = results.filter((r) => r.consensus === 'BUY' || r.consensus === 'SELL');
  const neutral = results.filter((r) => r.consensus === 'NEUTRAL');

  if (results.length === 0) return null;

  const renderRow = (r: TickerResult) => (
    <tr
      key={r.symbol}
      style={{ borderBottom: '1px solid var(--color-border-muted)', cursor: onSymbolClick ? 'pointer' : 'default' }}
      onClick={onSymbolClick ? () => onSymbolClick(r.symbol, r.consensus) : undefined}
    >
      <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
        {r.symbol}
      </td>
      <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {r.latest_close != null ? `$${r.latest_close.toFixed(2)}` : '—'}
      </td>
      {screenerIds.map((id) => (
        <td key={id} style={{ padding: '8px 10px' }}>
          {r.signals[id]
            ? <SignalBadge signal={r.signals[id]} symbol={r.symbol} onClick={onSymbolClick ? (sym, sig) => onSymbolClick(sym, sig) : undefined} />
            : <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>}
        </td>
      ))}
      <td style={{ padding: '8px 10px' }}>
        <SignalBadge signal={r.consensus} symbol={r.symbol} onClick={onSymbolClick ? (sym, sig) => onSymbolClick(sym, sig) : undefined} />
      </td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {actionList.length > 0 && (
        <div style={{
          borderRadius: 8,
          border: '1px solid var(--color-border-muted)',
          overflow: 'hidden',
          backgroundColor: 'var(--color-bg-card)',
        }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
              Action List
            </span>
            {requireUnanimous && (
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--color-border-muted)' }}>
                unanimous
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {actionList.length} ticker{actionList.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Symbol</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Price</th>
                  {screenerIds.map((id) => (
                    <th key={id} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'uppercase' }}>{id}</th>
                  ))}
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Consensus</th>
                </tr>
              </thead>
              <tbody>{actionList.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      )}

      {neutral.length > 0 && (
        <details style={{ borderRadius: 8, border: '1px solid var(--color-border-muted)', overflow: 'hidden', backgroundColor: 'var(--color-bg-card)' }}>
          <summary style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)', userSelect: 'none' }}>
            No signal — {neutral.length} ticker{neutral.length !== 1 ? 's' : ''}
          </summary>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Symbol</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Price</th>
                  {screenerIds.map((id) => (
                    <th key={id} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500, textTransform: 'uppercase' }}>{id}</th>
                  ))}
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>Consensus</th>
                </tr>
              </thead>
              <tbody>{neutral.map(renderRow)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
