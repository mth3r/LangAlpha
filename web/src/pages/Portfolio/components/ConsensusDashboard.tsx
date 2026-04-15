import React from 'react';

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
}

const SIGNAL_COLORS: Record<string, string> = {
  BUY: '#10b981',
  SELL: '#ef4444',
  NEUTRAL: '#6b7280',
};

function SignalBadge({ signal }: { signal: string }) {
  return (
    <span style={{
      padding: '2px 7px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      backgroundColor: `${SIGNAL_COLORS[signal] ?? '#6b7280'}22`,
      color: SIGNAL_COLORS[signal] ?? '#6b7280',
      border: `1px solid ${SIGNAL_COLORS[signal] ?? '#6b7280'}44`,
    }}>
      {signal}
    </span>
  );
}

export default function ConsensusDashboard({ results, screenerIds, requireUnanimous }: ConsensusDashboardProps) {
  const actionList = results.filter((r) => r.consensus === 'BUY' || r.consensus === 'SELL');
  const neutral = results.filter((r) => r.consensus === 'NEUTRAL');

  if (results.length === 0) return null;

  const renderRow = (r: TickerResult) => (
    <tr key={r.symbol} style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
      <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
        {r.symbol}
      </td>
      <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {r.latest_close != null ? `$${r.latest_close.toFixed(2)}` : '—'}
      </td>
      {screenerIds.map((id) => (
        <td key={id} style={{ padding: '8px 10px' }}>
          {r.signals[id] ? <SignalBadge signal={r.signals[id]} /> : <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>}
        </td>
      ))}
      <td style={{ padding: '8px 10px' }}>
        <SignalBadge signal={r.consensus} />
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
