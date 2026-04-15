import React, { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight, ChevronsUp, TrendingUp, Minus, TrendingDown, ChevronsDown } from 'lucide-react';
import type { PortfolioRow } from '../../Dashboard/hooks/usePortfolioData';

type SortKey =
  | 'symbol'
  | 'quantity'
  | 'average_cost'
  | 'price'
  | 'marketValue'
  | 'dayChange'
  | 'totalPl'
  | 'ytdPl'
  | 'analystRating'
  | 'ptUpside';

interface AnalystEntry {
  consensus: string | null;
  targetConsensus: number | null;
}

const CONSENSUS_RANK: Record<string, number> = {
  'Strong Buy': 5,
  'Buy': 4,
  'Hold': 3,
  'Sell': 2,
  'Strong Sell': 1,
};


const CONSENSUS_ICON_CONFIG: Record<string, {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  label: string;
}> = {
  'Strong Buy': { icon: ChevronsUp,    color: '#10b981', label: 'Strong Buy' },
  'Buy':        { icon: TrendingUp,    color: '#22c55e', label: 'Buy' },
  'Hold':       { icon: Minus,         color: '#f59e0b', label: 'Hold' },
  'Sell':       { icon: TrendingDown,  color: '#f97316', label: 'Sell' },
  'Strong Sell':{ icon: ChevronsDown,  color: '#ef4444', label: 'Strong Sell' },
};

function ConsensusIcon({ consensus, symbol, onClick }: { consensus: string; symbol: string; onClick?: (symbol: string, signal: string) => void }) {
  const cfg = CONSENSUS_ICON_CONFIG[consensus];
  if (!cfg) return <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>;
  const Icon = cfg.icon;
  return (
    <button
      title={cfg.label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(symbol, consensus);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 6,
        backgroundColor: `${cfg.color}18`,
        border: `1px solid ${cfg.color}44`,
        color: cfg.color,
        fontSize: 11,
        fontWeight: 600,
        cursor: onClick ? 'pointer' : 'default',
        lineHeight: 1,
      }}
    >
      <Icon size={12} />
      <span>{cfg.label}</span>
    </button>
  );
}

interface PortfolioTableProps {
  rows: PortfolioRow[];
  ytdPriceMap: Record<string, number | null>;
  analystMap?: Record<string, AnalystEntry>;
  onRowClick: (symbol: string) => void;
  onSignalClick?: (symbol: string, signal: string) => void;
}

interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function SortIcon({ col, sort }: { col: SortKey; sort: SortState }) {
  if (sort.key !== col)
    return <ArrowUpDown size={12} style={{ opacity: 0.35 }} />;
  return sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

function PlChip({ dollars, pct }: { dollars: number; pct: number }) {
  const isPos = dollars >= 0;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div
        className="flex items-center gap-0.5 text-xs font-semibold"
        style={{ color: isPos ? 'var(--color-profit)' : 'var(--color-loss)' }}
      >
        {isPos ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        {(isPos ? '+' : '-') +
          '$' +
          Math.abs(dollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div
        className="text-[10px] font-medium"
        style={{ color: isPos ? 'var(--color-profit)' : 'var(--color-loss)', opacity: 0.8 }}
      >
        {(isPos ? '+' : '') + pct.toFixed(2) + '%'}
      </div>
    </div>
  );
}

export default function PortfolioTable({ rows, ytdPriceMap, analystMap = {}, onRowClick, onSignalClick }: PortfolioTableProps) {
  const [sort, setSort] = useState<SortState>({ key: 'marketValue', dir: 'desc' });

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
    );
  };

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const qty = r.hasSplitAdjustment
          ? (r.splitAdjustedQuantity ?? r.quantity ?? 0)
          : (r.quantity ?? 0);
        const cost = r.hasSplitAdjustment
          ? (r.splitAdjustedCost ?? r.average_cost ?? 0)
          : (r.average_cost ?? 0);
        const mv = r.marketValue ?? qty * r.price;
        const dayDollars = r.dayChangeDollars ?? 0;
        const prevClose = r.previousClose ?? r.price;
        const dayPct = prevClose > 0 ? ((r.price - prevClose) / prevClose) * 100 : 0;
        const totalPlDollars = cost > 0 ? mv - qty * cost : 0;
        const totalPlPct = cost > 0 && qty * cost > 0 ? (totalPlDollars / (qty * cost)) * 100 : 0;
        const ytdPrice = ytdPriceMap[r.symbol];
        const ytdDollars = ytdPrice != null ? (r.price - ytdPrice) * qty : null;
        const ytdPct = ytdPrice != null && ytdPrice > 0 ? ((r.price - ytdPrice) / ytdPrice) * 100 : null;
        return { ...r, qty, cost, mv, dayDollars, dayPct, totalPlDollars, totalPlPct, ytdDollars, ytdPct };
      }),
    [rows, ytdPriceMap]
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...enriched].sort((a, b) => {
      switch (sort.key) {
        case 'symbol': return dir * a.symbol.localeCompare(b.symbol);
        case 'quantity': return dir * ((a.qty ?? 0) - (b.qty ?? 0));
        case 'average_cost': return dir * ((a.cost ?? 0) - (b.cost ?? 0));
        case 'price': return dir * (a.price - b.price);
        case 'marketValue': return dir * (a.mv - b.mv);
        case 'dayChange': return dir * (a.dayDollars - b.dayDollars);
        case 'totalPl': return dir * (a.totalPlDollars - b.totalPlDollars);
        case 'ytdPl': return dir * ((a.ytdDollars ?? 0) - (b.ytdDollars ?? 0));
        case 'analystRating': {
          const ra = CONSENSUS_RANK[analystMap[a.symbol]?.consensus ?? ''] ?? 0;
          const rb = CONSENSUS_RANK[analystMap[b.symbol]?.consensus ?? ''] ?? 0;
          return dir * (ra - rb);
        }
        case 'ptUpside': {
          const ua = analystMap[a.symbol]?.targetConsensus != null ? ((analystMap[a.symbol].targetConsensus! - a.price) / a.price) * 100 : -Infinity;
          const ub = analystMap[b.symbol]?.targetConsensus != null ? ((analystMap[b.symbol].targetConsensus! - b.price) / b.price) * 100 : -Infinity;
          return dir * (ua - ub);
        }
        default: return 0;
      }
    });
  }, [enriched, sort]);

  const th = (label: string, key: SortKey) => (
    <th
      className="px-4 py-3 text-left text-xs font-semibold cursor-pointer select-none whitespace-nowrap"
      style={{ color: 'var(--color-text-secondary)' }}
      onClick={() => toggleSort(key)}
    >
      <div className="flex items-center gap-1">
        {label}
        <SortIcon col={key} sort={sort} />
      </div>
    </th>
  );

  return (
    <div
      className="dashboard-glass-card overflow-hidden"
      style={{ overflowX: 'auto' }}
    >
      <table className="w-full text-sm border-collapse" style={{ minWidth: '720px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
            {th('Symbol', 'symbol')}
            {th('Qty', 'quantity')}
            {th('Avg Cost', 'average_cost')}
            {th('Price', 'price')}
            {th('Market Value', 'marketValue')}
            {th('Day Change', 'dayChange')}
            {th('Total P&L', 'totalPl')}
            {th('YTD P&L', 'ytdPl')}
            {th('Rating', 'analystRating')}
            {th('Upside', 'ptUpside')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.symbol}
              className="cursor-pointer transition-colors"
              style={{ borderBottom: '1px solid var(--color-border-muted)' }}
              onClick={() => onRowClick(row.symbol)}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {row.symbol}
                  </span>
                  {row.hasSplitAdjustment && (
                    <span
                      className="text-[9px] font-semibold px-1 py-0.5 rounded"
                      style={{
                        backgroundColor: 'var(--color-bg-hover)',
                        color: 'var(--color-text-secondary)',
                      }}
                      title="Split-adjusted"
                    >
                      adj.
                    </span>
                  )}
                </div>
              </td>

              <td className="px-4 py-3 dashboard-mono" style={{ color: 'var(--color-text-primary)' }}>
                {row.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </td>

              <td className="px-4 py-3 dashboard-mono" style={{ color: 'var(--color-text-secondary)' }}>
                {row.cost > 0 ? '$' + row.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
              </td>

              <td className="px-4 py-3 dashboard-mono font-medium" style={{ color: 'var(--color-text-primary)' }}>
                ${row.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>

              <td className="px-4 py-3 dashboard-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                ${row.mv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>

              <td className="px-4 py-3">
                <PlChip dollars={row.dayDollars} pct={row.dayPct} />
              </td>

              <td className="px-4 py-3">
                {row.cost > 0 ? (
                  <PlChip dollars={row.totalPlDollars} pct={row.totalPlPct} />
                ) : (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                )}
              </td>

              <td className="px-4 py-3">
                {row.ytdDollars != null && row.ytdPct != null ? (
                  <PlChip dollars={row.ytdDollars} pct={row.ytdPct} />
                ) : (
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    loading…
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs">
                {(() => {
                  const consensus = analystMap[row.symbol]?.consensus;
                  if (!consensus) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
                  return (
                    <ConsensusIcon
                      consensus={consensus}
                      symbol={row.symbol}
                      onClick={onSignalClick}
                    />
                  );
                })()}
              </td>
              <td className="px-4 py-3 text-xs text-right">
                {(() => {
                  const target = analystMap[row.symbol]?.targetConsensus;
                  if (target == null) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
                  const upside = ((target - row.price) / row.price) * 100;
                  return (
                    <span style={{ fontWeight: 600, color: upside >= 0 ? 'var(--color-profit)' : 'var(--color-loss)' }}>
                      {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%
                    </span>
                  );
                })()}
              </td>
            </tr>
          ))}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                No holdings. Add positions from the dashboard.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
