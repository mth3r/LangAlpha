import React from 'react';

export interface ScreenerConfig {
  activeScreeners: string[];
  requireUnanimous: boolean;
  hhmaLength: number;
  rsiPeriod: number;
}

interface ScreenerControlsProps {
  config: ScreenerConfig;
  onChange: (next: ScreenerConfig) => void;
  loading: boolean;
  onScan: () => void;
}

const SCREENERS = [
  { id: 'hhma', label: 'HHMA', description: 'Hyperbolic Hull MA slope' },
  { id: 'rsi', label: 'RSI', description: 'Oversold / overbought' },
  { id: 'volume', label: 'Volume', description: 'Volume surge confirmation' },
];

export default function ScreenerControls({ config, onChange, loading, onScan }: ScreenerControlsProps) {
  const toggle = (id: string) => {
    const next = config.activeScreeners.includes(id)
      ? config.activeScreeners.filter((s) => s !== id)
      : [...config.activeScreeners, id];
    onChange({ ...config, activeScreeners: next });
  };

  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 8,
      border: '1px solid var(--color-border-muted)',
      backgroundColor: 'var(--color-bg-card)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text-primary)' }}>
          Screeners
        </span>
        <button
          onClick={onScan}
          disabled={loading || config.activeScreeners.length === 0}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: 'var(--color-accent-primary)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: config.activeScreeners.length === 0 || loading ? 'not-allowed' : 'pointer',
            opacity: config.activeScreeners.length === 0 || loading ? 0.5 : 1,
          }}
        >
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {/* Screener toggles */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SCREENERS.map(({ id, label, description }) => {
          const active = config.activeScreeners.includes(id);
          return (
            <button
              key={id}
              onClick={() => toggle(id)}
              title={description}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${active ? 'var(--color-accent-primary)' : 'var(--color-border-muted)'}`,
                backgroundColor: active ? 'var(--color-accent-primary)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Universal consensus toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={config.requireUnanimous}
          onChange={(e) => onChange({ ...config, requireUnanimous: e.target.checked })}
          style={{ accentColor: 'var(--color-accent-primary)' }}
        />
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          Require universal consensus
        </span>
      </label>

      {/* Compact param inputs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {config.activeScreeners.includes('hhma') && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            HHMA length
            <input
              type="number"
              min={5}
              max={200}
              value={config.hhmaLength}
              onChange={(e) => onChange({ ...config, hhmaLength: Number(e.target.value) })}
              style={{ width: 52, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--color-border-muted)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', fontSize: 12 }}
            />
          </label>
        )}
        {config.activeScreeners.includes('rsi') && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            RSI period
            <input
              type="number"
              min={2}
              max={100}
              value={config.rsiPeriod}
              onChange={(e) => onChange({ ...config, rsiPeriod: Number(e.target.value) })}
              style={{ width: 52, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--color-border-muted)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', fontSize: 12 }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
