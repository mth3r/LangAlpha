import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import MarketChart from '../../MarketView/components/MarketChart';
import type { SignalMarker } from '../../MarketView/hooks/useChartOverlays';

interface TickerChartModalProps {
  symbol: string | null;
  onClose: () => void;
  signalMarker?: SignalMarker | null;
}

export default function TickerChartModal({ symbol, onClose, signalMarker }: TickerChartModalProps) {
  useEffect(() => {
    if (!symbol) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [symbol, onClose]);

  if (!symbol) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-stretch"
      onClick={onClose}
    >
      {/* Dim backdrop */}
      <div className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} />

      {/* Panel */}
      <div
        className="flex flex-col"
        style={{
          width: 'min(72%, 1100px)',
          backgroundColor: 'var(--color-bg-page)',
          borderLeft: '1px solid var(--color-border-muted)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border-muted)' }}
        >
          <span className="font-bold text-base" style={{ color: 'var(--color-text-primary)' }}>
            {symbol}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0">
          <MarketChart
            symbol={symbol}
            quoteData={null}
            earningsData={null}
            overlayData={null}
            stockMeta={null}
            liveTick={null}
            wsStatus="disconnected"
            snapshot={null}
            signalMarker={signalMarker}
          />
        </div>
      </div>
    </div>
  );
}
