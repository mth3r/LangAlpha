import React, { useState } from 'react';
import { Plus, Upload, ArrowUpRight, ArrowDownRight, Trash2, Pencil, Eye, EyeOff, Sunrise, Sunset, MoreVertical, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import ImportPortfolioDialog from './ImportPortfolioDialog';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { getExtendedHoursInfo } from '@/lib/marketUtils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { getYtdStartPrice } from '../utils/api';

type PlPeriod = 'day' | 'ytd' | 'alltime';
type PlFormat = 'pct' | 'dollar';

interface WatchlistRow {
  watchlist_item_id?: string | number;
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  isPositive: boolean;
  previousClose?: number | null;
  earlyTradingChangePercent?: number | null;
  lateTradingChangePercent?: number | null;
  [key: string]: unknown;
}

interface PortfolioRow {
  user_portfolio_id?: string | number;
  symbol: string;
  price: number;
  quantity?: number | null;
  average_cost?: number | null;
  first_purchased_at?: string | null;
  splitAdjustedCost?: number | null;
  splitAdjustedQuantity?: number | null;
  hasSplitAdjustment?: boolean;
  marketValue?: number;
  unrealizedPlPercent?: number | null;
  isPositive?: boolean;
  previousClose?: number | null;
  earlyTradingChangePercent?: number | null;
  lateTradingChangePercent?: number | null;
  dayChangeDollars?: number | null;
  dayChangePct?: number | null;
  [key: string]: unknown;
}

// TODO: type properly once marketUtils exports this
type MarketStatusData = Parameters<typeof getExtendedHoursInfo>[0];

function getPlDisplay(
  item: PortfolioRow,
  period: PlPeriod,
  format: PlFormat,
  ytdPriceMap: Record<string, number | null>,
): { str: string; isPos: boolean } {
  const qty = item.hasSplitAdjustment
    ? (item.splitAdjustedQuantity ?? item.quantity ?? 0)
    : (item.quantity ?? 0);
  const cost = item.hasSplitAdjustment
    ? (item.splitAdjustedCost ?? item.average_cost ?? 0)
    : (item.average_cost ?? 0);
  const price = item.price ?? 0;
  const marketValue = item.marketValue ?? qty * price;

  let dollars: number | null = null;
  let pct: number | null = null;

  if (period === 'day') {
    dollars = item.dayChangeDollars ?? null;
    pct = item.dayChangePct ?? null;
  } else if (period === 'ytd') {
    const ytdPrice = ytdPriceMap[item.symbol];
    if (ytdPrice != null) {
      dollars = (price - ytdPrice) * qty;
      pct = ytdPrice > 0 ? ((price - ytdPrice) / ytdPrice) * 100 : 0;
    }
  } else {
    if (cost > 0) {
      dollars = marketValue - qty * cost;
      pct = item.unrealizedPlPercent ?? null;
    }
  }

  if (format === 'pct') {
    if (pct == null) return { str: '—', isPos: true };
    const isPos = pct >= 0;
    return { str: (isPos ? '+' : '') + pct.toFixed(2) + '%', isPos };
  } else {
    if (dollars == null) return { str: '—', isPos: true };
    const isPos = dollars >= 0;
    return {
      str:
        (isPos ? '+' : '-') +
        '$' +
        Math.abs(dollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      isPos,
    };
  }
}

interface WatchlistItemProps {
  item: WatchlistRow;
  index: number;
  onDelete?: (id: string) => void;
  marketStatus: MarketStatusData;
  isMobile: boolean;
}

function WatchlistItem({ item, index, onDelete, marketStatus, isMobile }: WatchlistItemProps) {
  const navigate = useNavigate();
  const pos = item.isPositive;
  const pctStr = (pos ? '+' : '') + Number(item.changePercent).toFixed(2) + '%';
  const hasId = !!item.watchlist_item_id;

  const { extPct, extType, extPrice: _extPrice, extChange: _extChange } = getExtendedHoursInfo(marketStatus, item, { shortLabels: true });
  const extColor = extType === 'pre' ? '#fbbf24' : '#3b82f6';

  const rowContent = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center justify-between p-3 rounded-xl border border-transparent transition-all cursor-pointer"
      style={{ backgroundColor: 'transparent' }}
      onClick={() => navigate(`/market?symbol=${encodeURIComponent(item.symbol)}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)';
        e.currentTarget.style.borderColor = 'var(--color-border-muted)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <div>
        <div className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>
          {item.symbol}
        </div>
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Stock</div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm font-medium dashboard-mono" style={{ color: 'var(--color-text-primary)' }}>
            {Number(extType && item.previousClose != null ? item.previousClose : item.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs font-medium dashboard-mono" style={{ color: pos ? 'var(--color-profit)' : 'var(--color-loss)' }}>
            {(pos ? '+' : '') + Number(item.change).toFixed(2)}
          </div>
        </div>

        <div className="text-right">
          <div
            className="w-16 py-1 rounded-lg text-center text-xs font-bold"
            style={{
              backgroundColor: pos ? 'var(--color-profit-soft)' : 'var(--color-loss-soft)',
              color: pos ? 'var(--color-profit)' : 'var(--color-loss)',
            }}
          >
            {pctStr}
          </div>
          {extType && extPct != null && (
            <div className="text-[10px] mt-0.5 text-center flex items-center justify-center gap-0.5" style={{ color: extColor }}>
              {extType === 'pre' ? <Sunrise size={10} /> : <Sunset size={10} />}
              {Number(item.price).toFixed(2)} {extPct >= 0 ? '+' : ''}{extPct.toFixed(2)}%
            </div>
          )}
        </div>

        {isMobile && hasId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 -mr-1 rounded-md transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(String(item.watchlist_item_id))}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </motion.div>
  );

  if (!isMobile && hasId) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem variant="destructive" onSelect={() => onDelete?.(String(item.watchlist_item_id))}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return rowContent;
}

interface PortfolioItemProps {
  item: PortfolioRow;
  index: number;
  onEdit?: (item: PortfolioRow) => void;
  onDelete?: (id: string) => void;
  valuesHidden: boolean;
  marketStatus: MarketStatusData;
  isMobile: boolean;
  plPeriod: PlPeriod;
  plFormat: PlFormat;
  ytdPriceMap: Record<string, number | null>;
}

function PortfolioItem({ item, index, onEdit, onDelete, valuesHidden, marketStatus, isMobile, plPeriod, plFormat, ytdPriceMap }: PortfolioItemProps) {
  const navigate = useNavigate();
  const { str: plStr, isPos: pos } = getPlDisplay(item, plPeriod, plFormat, ytdPriceMap);
  const hasId = !!item.user_portfolio_id;

  const { extPct, extType, extPrice: _extPrice2 } = getExtendedHoursInfo(marketStatus, item, { shortLabels: true });
  const extColor = extType === 'pre' ? '#fbbf24' : '#3b82f6';

  const rowContent = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center justify-between p-3 rounded-xl border border-transparent transition-all cursor-pointer"
      style={{ backgroundColor: 'transparent' }}
      onClick={() => navigate(`/market?symbol=${encodeURIComponent(item.symbol)}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)';
        e.currentTarget.style.borderColor = 'var(--color-border-muted)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <div>
        <div className="font-bold text-sm flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
          {item.symbol}
          {item.hasSplitAdjustment && (
            <span
              className="text-[9px] font-semibold px-1 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
              title={`Split-adjusted cost: $${Number(item.splitAdjustedCost).toFixed(2)} (original: $${Number(item.average_cost).toFixed(2)})`}
            >
              split adj.
            </span>
          )}
        </div>
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {valuesHidden ? '*** shares' : item.quantity != null ? `${Number(item.hasSplitAdjustment ? item.splitAdjustedQuantity : item.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })} shares` : ''}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm font-medium dashboard-mono" style={{ color: 'var(--color-text-primary)' }}>
            {valuesHidden ? '******' : `$${Number(item.marketValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div className="text-xs dashboard-mono" style={{ color: 'var(--color-text-secondary)' }}>
            {valuesHidden ? '***' : `@${Number(extType && item.previousClose != null ? item.previousClose : item.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        </div>

        <div className="text-right">
          <div
            className="w-16 py-1 rounded-lg text-center text-xs font-bold"
            style={{
              backgroundColor: pos ? 'var(--color-profit-soft)' : 'var(--color-loss-soft)',
              color: pos ? 'var(--color-profit)' : 'var(--color-loss)',
            }}
          >
            {valuesHidden ? '—' : plStr}
          </div>
          {extType && extPct != null && (
            <div className="text-[10px] mt-0.5 text-center flex items-center justify-center gap-0.5" style={{ color: extColor }}>
              {extType === 'pre' ? <Sunrise size={10} /> : <Sunset size={10} />}
              {Number(item.price).toFixed(2)} {extPct >= 0 ? '+' : ''}{extPct.toFixed(2)}%
            </div>
          )}
        </div>

        {isMobile && hasId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 -mr-1 rounded-md transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit?.(item)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(String(item.user_portfolio_id))}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </motion.div>
  );

  if (!isMobile && hasId) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onEdit?.(item)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => onDelete?.(String(item.user_portfolio_id))}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return rowContent;
}

interface AddNewButtonProps {
  label: string;
  onClick?: () => void;
}

function AddNewButton({ label, onClick }: AddNewButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2 w-full py-3 mt-2 rounded-xl border border-dashed text-sm font-medium transition-all"
      style={{
        borderColor: 'var(--color-border-default)',
        color: 'var(--color-text-secondary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-elevated)';
        e.currentTarget.style.color = 'var(--color-text-primary)';
        e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-default)';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
        e.currentTarget.style.backgroundColor = '';
      }}
    >
      <Plus size={16} /> {label}
    </button>
  );
}

type PWTabKey = 'watchlist' | 'portfolio';

interface PortfolioWatchlistCardProps {
  watchlistRows?: WatchlistRow[];
  watchlistLoading?: boolean;
  onWatchlistAdd?: () => void;
  onWatchlistDelete?: (id: string) => void;
  portfolioRows?: PortfolioRow[];
  portfolioLoading?: boolean;
  hasRealHoldings?: boolean;
  onPortfolioAdd?: () => void;
  onPortfolioDelete?: (id: string) => void;
  onPortfolioEdit?: (item: PortfolioRow) => void;
  marketStatus: MarketStatusData;
}

function PortfolioWatchlistCard({
  watchlistRows = [],
  watchlistLoading = false,
  onWatchlistAdd,
  onWatchlistDelete,
  portfolioRows = [],
  portfolioLoading = false,
  hasRealHoldings = false,
  onPortfolioAdd,
  onPortfolioDelete,
  onPortfolioEdit,
  marketStatus,
}: PortfolioWatchlistCardProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTabRaw] = useState<PWTabKey>(() => (localStorage.getItem('portfolio_active_tab') as PWTabKey) || 'watchlist');
  const [valuesHidden, setValuesHiddenRaw] = useState(() => localStorage.getItem('portfolio_values_hidden') === 'true');
  const [plPeriod, setPlPeriodRaw] = useState<PlPeriod>(() => (localStorage.getItem('portfolio_pnl_period') as PlPeriod) || 'alltime');
  const [plFormat, setPlFormatRaw] = useState<PlFormat>(() => (localStorage.getItem('portfolio_pnl_format') as PlFormat) || 'pct');
  const [showImport, setShowImport] = useState(false);

  const setActiveTab = (tab: PWTabKey) => {
    setActiveTabRaw(tab);
    localStorage.setItem('portfolio_active_tab', tab);
  };
  const setValuesHidden = (updater: boolean | ((prev: boolean) => boolean)) => {
    setValuesHiddenRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem('portfolio_values_hidden', String(next));
      return next;
    });
  };
  const setPlPeriod = (p: PlPeriod) => {
    setPlPeriodRaw(p);
    localStorage.setItem('portfolio_pnl_period', p);
  };
  const setPlFormat = (f: PlFormat) => {
    setPlFormatRaw(f);
    localStorage.setItem('portfolio_pnl_format', f);
  };

  // Fetch YTD start prices only when YTD period is selected
  const symbols = portfolioRows.map((r) => r.symbol);
  const { data: ytdPriceMap = {} } = useQuery<Record<string, number | null>>({
    queryKey: ['ytdPrices', symbols.join(',')],
    queryFn: async () => {
      const map: Record<string, number | null> = {};
      await Promise.all(symbols.map(async (sym) => {
        map[sym] = await getYtdStartPrice(sym);
      }));
      return map;
    },
    enabled: plPeriod === 'ytd' && symbols.length > 0,
    staleTime: 1000 * 60 * 60, // 1 hour — YTD start price doesn't change intraday
  });

  // Portfolio summary
  const totalValue = portfolioRows.reduce((sum, r) => sum + (r.marketValue || 0), 0);
  const totalCost = portfolioRows.reduce(
    (sum, r) => sum + (r.average_cost != null ? r.average_cost * (r.quantity || 0) : 0),
    0,
  );

  // Summary P&L changes based on selected period
  const summaryPl = (() => {
    if (plPeriod === 'day') {
      const dollars = portfolioRows.reduce((sum, r) => sum + (r.dayChangeDollars ?? 0), 0);
      const prevTotal = portfolioRows.reduce((sum, r) => {
        const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
        return sum + (r.previousClose ?? r.price) * qty;
      }, 0);
      const pct = prevTotal > 0 ? (dollars / prevTotal) * 100 : 0;
      return { dollars, pct, isPos: dollars >= 0 };
    } else if (plPeriod === 'ytd') {
      const dollars = portfolioRows.reduce((sum, r) => {
        const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
        const ytdPrice = ytdPriceMap[r.symbol];
        return sum + (ytdPrice != null ? (r.price - ytdPrice) * qty : 0);
      }, 0);
      const ytdStart = portfolioRows.reduce((sum, r) => {
        const qty = r.hasSplitAdjustment ? (r.splitAdjustedQuantity ?? r.quantity ?? 0) : (r.quantity ?? 0);
        const ytdPrice = ytdPriceMap[r.symbol];
        return sum + (ytdPrice ?? r.price) * qty;
      }, 0);
      const pct = ytdStart > 0 ? (dollars / ytdStart) * 100 : 0;
      return { dollars, pct, isPos: dollars >= 0 };
    } else {
      const dollars = totalCost > 0 ? totalValue - totalCost : 0;
      const pct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
      return { dollars, pct, isPos: dollars >= 0 };
    }
  })();

  const periodLabel = plPeriod === 'day' ? 'today' : plPeriod === 'ytd' ? 'YTD' : 'all time';

  return (
    <div
      className="dashboard-glass-card p-6 flex flex-col"
      style={{ minHeight: '200px', maxHeight: 'clamp(300px, calc(100vh - 420px), 800px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {activeTab === 'watchlist' ? 'Watchlist' : 'Portfolio'}
        </h2>
        <div className="flex rounded-xl p-1" style={{ backgroundColor: 'var(--color-bg-tag)' }}>
          <button
            onClick={() => setActiveTab('watchlist')}
            className="px-3 py-1 text-xs font-medium rounded-lg transition-all"
            style={{
              backgroundColor: activeTab === 'watchlist' ? 'var(--color-bg-elevated)' : 'transparent',
              color: activeTab === 'watchlist' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            Watch
          </button>
          <button
            onClick={() => setActiveTab('portfolio')}
            className="px-3 py-1 text-xs font-medium rounded-lg transition-all"
            style={{
              backgroundColor: activeTab === 'portfolio' ? 'var(--color-bg-elevated)' : 'transparent',
              color: activeTab === 'portfolio' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            Holdings
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1">
        <AnimatePresence mode="wait">
          {activeTab === 'watchlist' ? (
            <motion.div
              key="watchlist"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-1"
            >
              {watchlistLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                      <div className="flex-1">
                        <div className="h-4 rounded mb-1" style={{ backgroundColor: 'var(--color-border-default)', width: '40%' }} />
                        <div className="h-3 rounded" style={{ backgroundColor: 'var(--color-border-default)', width: '25%' }} />
                      </div>
                    </div>
                  ))
                : watchlistRows.map((item, i) => (
                    <WatchlistItem
                      key={item.watchlist_item_id ?? item.symbol}
                      item={item}
                      index={i}
                      onDelete={onWatchlistDelete}
                      marketStatus={marketStatus}
                      isMobile={isMobile}
                    />
                  ))}
              <AddNewButton label="Add Symbol" onClick={onWatchlistAdd} />
            </motion.div>
          ) : (
            <motion.div
              key="portfolio"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex flex-col gap-1"
            >
              {/* Summary card */}
              {hasRealHoldings && (
                <div
                  className="p-4 rounded-2xl border mb-4"
                  style={{
                    background: `linear-gradient(135deg, var(--color-accent-soft) 0%, var(--color-bg-card) 100%)`,
                    borderColor: 'var(--color-accent-overlay)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      Net Asset Value
                    </div>
                    <div className="flex items-center gap-0.5">
                      {/* P&L settings gear */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="p-1 rounded-md transition-colors"
                            style={{ color: 'var(--color-text-secondary)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            title="P&L display settings"
                          >
                            <Settings size={13} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="p-3 w-44" onClick={(e) => e.stopPropagation()}>
                          <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Show P&amp;L</div>
                          <div className="flex gap-1 mb-3">
                            {(['day', 'ytd', 'alltime'] as const).map((p) => (
                              <button
                                key={p}
                                onClick={() => setPlPeriod(p)}
                                className="flex-1 py-1 text-xs rounded-md font-medium transition-colors"
                                style={{
                                  backgroundColor: plPeriod === p ? 'var(--color-bg-elevated)' : 'transparent',
                                  color: plPeriod === p ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                  outline: plPeriod === p ? '1px solid var(--color-border-elevated)' : 'none',
                                }}
                              >
                                {p === 'day' ? 'Day' : p === 'ytd' ? 'YTD' : 'All'}
                              </button>
                            ))}
                          </div>
                          <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Format</div>
                          <div className="flex gap-1">
                            {(['pct', 'dollar'] as const).map((f) => (
                              <button
                                key={f}
                                onClick={() => setPlFormat(f)}
                                className="flex-1 py-1 text-xs rounded-md font-medium transition-colors"
                                style={{
                                  backgroundColor: plFormat === f ? 'var(--color-bg-elevated)' : 'transparent',
                                  color: plFormat === f ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                  outline: plFormat === f ? '1px solid var(--color-border-elevated)' : 'none',
                                }}
                              >
                                {f === 'pct' ? '%' : '$'}
                              </button>
                            ))}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {/* Eye toggle */}
                      <button
                        onClick={() => setValuesHidden((h) => !h)}
                        className="p-1 rounded-md transition-colors"
                        style={{ color: 'var(--color-text-secondary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        {valuesHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div className="text-2xl font-bold mb-2 dashboard-mono" style={{ color: 'var(--color-text-primary)' }}>
                    {valuesHidden ? '********' : `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </div>
                  {!valuesHidden && (
                    <div
                      className="flex items-center gap-1.5 text-xs font-medium w-fit px-2 py-1 rounded-full"
                      style={{
                        backgroundColor: summaryPl.isPos ? 'var(--color-profit-soft)' : 'var(--color-loss-soft)',
                        color: summaryPl.isPos ? 'var(--color-profit)' : 'var(--color-loss)',
                      }}
                    >
                      {summaryPl.isPos ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {summaryPl.isPos ? '+' : '-'}${Math.abs(summaryPl.dollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({summaryPl.pct.toFixed(1)}%)
                      <span className="opacity-60">{periodLabel}</span>
                    </div>
                  )}
                </div>
              )}

              {portfolioLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                      <div className="flex-1">
                        <div className="h-4 rounded mb-1" style={{ backgroundColor: 'var(--color-border-default)', width: '40%' }} />
                        <div className="h-3 rounded" style={{ backgroundColor: 'var(--color-border-default)', width: '25%' }} />
                      </div>
                    </div>
                  ))
                : portfolioRows.map((item, i) => (
                    <PortfolioItem
                      key={item.user_portfolio_id ?? item.symbol}
                      item={item}
                      index={i}
                      onEdit={onPortfolioEdit}
                      onDelete={onPortfolioDelete}
                      valuesHidden={valuesHidden}
                      marketStatus={marketStatus}
                      isMobile={isMobile}
                      plPeriod={plPeriod}
                      plFormat={plFormat}
                      ytdPriceMap={ytdPriceMap}
                    />
                  ))}
              <AddNewButton label="Add Transaction" onClick={onPortfolioAdd} />
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 w-full mt-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              >
                <Upload size={14} /> Import from CSV
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ImportPortfolioDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => { setShowImport(false); onPortfolioAdd?.(); }}
      />
    </div>
  );
}

export default PortfolioWatchlistCard;
