import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { PortfolioRow } from '../../Dashboard/hooks/usePortfolioData';

interface PortfolioSummaryCardsProps {
  rows: PortfolioRow[];
  ytdPriceMap: Record<string, number | null>;
}

interface SummaryCard {
  label: string;
  value: string;
  delta: string | null;
  isPos: boolean | null;
}

export default function PortfolioSummaryCards({ rows, ytdPriceMap }: PortfolioSummaryCardsProps) {
  const totalValue = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);

  const totalCost = rows.reduce((s, r) => {
    const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
    const cost = r.hasSplitAdjustment ? (r.splitAdjustedCost ?? r.average_cost ?? 0) : (r.average_cost ?? 0);
    return s + qty * cost;
  }, 0);

  const dayDollars = rows.reduce((s, r) => s + (r.dayChangeDollars ?? 0), 0);
  const prevTotal = rows.reduce((s, r) => {
    const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
    return s + (r.previousClose ?? r.price) * qty;
  }, 0);
  const dayPct = prevTotal > 0 ? (dayDollars / prevTotal) * 100 : 0;

  const allTimeDollars = totalCost > 0 ? totalValue - totalCost : 0;
  const allTimePct = totalCost > 0 ? (allTimeDollars / totalCost) * 100 : 0;

  const ytdDollars = rows.reduce((s, r) => {
    const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
    const ytdPrice = ytdPriceMap[r.symbol];
    return s + (ytdPrice != null ? (r.price - ytdPrice) * qty : 0);
  }, 0);
  const ytdStart = rows.reduce((s, r) => {
    const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
    const ytdPrice = ytdPriceMap[r.symbol];
    return s + (ytdPrice ?? r.price) * qty;
  }, 0);
  const ytdPct = ytdStart > 0 ? (ytdDollars / ytdStart) * 100 : 0;

  const fmt$ = (n: number) =>
    (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

  const cards: SummaryCard[] = [
    {
      label: 'Market Value',
      value: '$' + totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      delta: null,
      isPos: null,
    },
    {
      label: 'Day P&L',
      value: fmt$(dayDollars),
      delta: fmtPct(dayPct),
      isPos: dayDollars >= 0,
    },
    {
      label: 'Total P&L',
      value: fmt$(allTimeDollars),
      delta: fmtPct(allTimePct),
      isPos: allTimeDollars >= 0,
    },
    {
      label: 'YTD P&L',
      value: fmt$(ytdDollars),
      delta: fmtPct(ytdPct),
      isPos: ytdDollars >= 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="dashboard-glass-card p-4"
        >
          <div className="text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            {card.label}
          </div>
          <div
            className="text-xl font-bold dashboard-mono mb-1"
            style={{
              color:
                card.isPos == null
                  ? 'var(--color-text-primary)'
                  : card.isPos
                  ? 'var(--color-profit)'
                  : 'var(--color-loss)',
            }}
          >
            {card.value}
          </div>
          {card.delta != null && card.isPos != null && (
            <div
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: card.isPos ? 'var(--color-profit)' : 'var(--color-loss)' }}
            >
              {card.isPos ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {card.delta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
