import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import {
  PerformanceBarChart,
  AnalystRatingsChart,
  QuarterlyRevenueChart,
  MarginsChart,
  EarningsSurpriseChart,
  CashFlowChart,
  RevenueBreakdownChart,
} from '../../ChatAgent/components/charts/MarketDataCharts';
import type { TechnicalsData } from '../hooks/useStockData';
import './CompanyOverviewPanel.css';

const GREEN = 'var(--color-profit)';
const RED = 'var(--color-loss)';
const TEXT_SEC = 'var(--color-text-secondary)';
const TEXT_PRI = 'var(--color-text-primary)';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteData {
  price?: number;
  change?: number;
  changePct?: number;
  open?: number;
  previousClose?: number;
  dayLow?: number;
  dayHigh?: number;
  yearLow?: number;
  yearHigh?: number;
  volume?: number;
  marketCap?: number;
  pe?: number;
  eps?: number;
}

interface OverviewData {
  symbol?: string;
  name?: string;
  quote?: QuoteData;
  performance?: unknown;
  analystRatings?: unknown;
  quarterlyFundamentals?: unknown;
  earningsSurprises?: unknown;
  cashFlow?: unknown;
  revenueByProduct?: unknown;
  revenueByGeo?: unknown;
  [key: string]: unknown;
}

interface RatingsConsensus {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  consensus?: string | null;
}

interface PriceTargets {
  targetHigh?: number;
  targetLow?: number;
  targetConsensus?: number;
  [key: string]: unknown;
}

interface AnalystGrade {
  date?: string;
  company?: string;
  previousGrade?: string | null;
  newGrade?: string | null;
  action?: string | null;
  [key: string]: unknown;
}

interface AnalystData {
  priceTargets?: PriceTargets | null;
  grades?: AnalystGrade[];
  ratingsConsensus?: RatingsConsensus | null;
}

interface CompanyOverviewPanelProps {
  symbol: string | null;
  visible: boolean;
  onClose: () => void;
  data: OverviewData | null;
  loading: boolean;
  analystData?: AnalystData | null;
  technicalData?: TechnicalsData | null;
  technicalLoading?: boolean;
}

type TabId = 'overview' | 'technicals' | 'analyst';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatNumber = (num: number | null | undefined): string => {
  if (num == null) return 'N/A';
  if (Math.abs(num) >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return typeof num === 'number' ? `$${num.toFixed(2)}` : String(num);
};

function QuoteStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ fontSize: 12, color: TEXT_SEC, opacity: 0.7 }}>{label}</span>
      <span style={{ fontSize: 12, color: TEXT_PRI }}>{value}</span>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: OverviewData }) {
  const { symbol, name, quote } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {quote && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: TEXT_PRI }}>{name || symbol}</span>
            <span style={{ fontSize: 13, color: TEXT_SEC }}>{symbol}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: TEXT_PRI }}>
              ${quote.price?.toFixed(2) || 'N/A'}
            </span>
            {quote.change != null && (
              <span style={{ fontSize: 13, color: quote.change >= 0 ? GREEN : RED }}>
                {quote.change >= 0 ? '+' : ''}{quote.change?.toFixed(2)} ({quote.changePct?.toFixed(2)}%)
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            {quote.open != null && <QuoteStat label="Open" value={`$${quote.open.toFixed(2)}`} />}
            {quote.previousClose != null && <QuoteStat label="Prev Close" value={`$${quote.previousClose.toFixed(2)}`} />}
            {quote.dayLow != null && quote.dayHigh != null && (
              <QuoteStat label="Day Range" value={`$${quote.dayLow.toFixed(2)} - $${quote.dayHigh.toFixed(2)}`} />
            )}
            {quote.yearLow != null && quote.yearHigh != null && (
              <QuoteStat label="52W Range" value={`$${quote.yearLow.toFixed(2)} - $${quote.yearHigh.toFixed(2)}`} />
            )}
            {quote.volume != null && <QuoteStat label="Volume" value={formatNumber(quote.volume).replace('$', '')} />}
            {quote.marketCap != null && <QuoteStat label="Market Cap" value={formatNumber(quote.marketCap)} />}
            {quote.pe != null && <QuoteStat label="P/E" value={quote.pe.toFixed(2)} />}
            {quote.eps != null && <QuoteStat label="EPS" value={`$${quote.eps.toFixed(2)}`} />}
          </div>
        </div>
      )}
      <PerformanceBarChart performance={data.performance as Record<string, number> | undefined} />
      <AnalystRatingsChart ratings={data.analystRatings as Record<string, unknown> | undefined} />
      <QuarterlyRevenueChart data={data.quarterlyFundamentals as Record<string, unknown>[] | undefined} />
      <MarginsChart data={data.quarterlyFundamentals as Record<string, unknown>[] | undefined} />
      <EarningsSurpriseChart data={data.earningsSurprises as Record<string, unknown>[] | undefined} />
      <CashFlowChart data={data.cashFlow as Record<string, unknown>[] | undefined} />
      <RevenueBreakdownChart
        revenueByProduct={data.revenueByProduct as Record<string, number> | undefined}
        revenueByGeo={data.revenueByGeo as Record<string, number> | undefined}
      />
    </div>
  );
}

// ─── Technicals Tab ───────────────────────────────────────────────────────────

const SIGNAL_COLOR: Record<string, string> = {
  Buy: GREEN,
  Sell: RED,
  Neutral: 'var(--color-text-tertiary)',
};

function SignalChip({ signal }: { signal: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 7px',
        borderRadius: 4,
        color: SIGNAL_COLOR[signal] ?? TEXT_SEC,
        backgroundColor: signal === 'Buy'
          ? 'rgba(var(--profit-rgb, 52,211,153), 0.12)'
          : signal === 'Sell'
          ? 'rgba(var(--loss-rgb, 239,68,68), 0.12)'
          : 'var(--color-bg-tag)',
        letterSpacing: '0.3px',
      }}
    >
      {signal}
    </span>
  );
}

function SummaryGauge({ buy, neutral, sell }: { buy: number; neutral: number; sell: number }) {
  const total = buy + neutral + sell || 1;
  const buyPct = (buy / total) * 100;
  const neutralPct = (neutral / total) * 100;
  const sellPct = (sell / total) * 100;

  const net = buy - sell;
  let label = 'Neutral';
  if (net >= buy * 0.6) label = 'Strong Buy';
  else if (net > 0) label = 'Buy';
  else if (net <= -sell * 0.6) label = 'Strong Sell';
  else if (net < 0) label = 'Sell';

  const labelColor =
    label === 'Strong Buy' ? GREEN :
    label === 'Buy' ? GREEN :
    label === 'Strong Sell' ? RED :
    label === 'Sell' ? RED :
    TEXT_SEC;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: TEXT_SEC, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          Summary
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: labelColor }}>{label}</span>
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 }}>
        <div style={{ flex: buyPct, backgroundColor: 'var(--color-profit)', minWidth: buy > 0 ? 2 : 0 }} />
        <div style={{ flex: neutralPct, backgroundColor: 'var(--color-border-default)', minWidth: neutral > 0 ? 2 : 0 }} />
        <div style={{ flex: sellPct, backgroundColor: 'var(--color-loss)', minWidth: sell > 0 ? 2 : 0 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: GREEN }}>{buy} Buy</span>
        <span style={{ fontSize: 10, color: TEXT_SEC }}>{neutral} Neutral</span>
        <span style={{ fontSize: 10, color: RED }}>{sell} Sell</span>
      </div>
    </div>
  );
}

function SignalTable({ title, signals }: { title: string; signals: TechnicalsData['oscillators'] }) {
  if (!signals.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_SEC, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {signals.map((s) => (
            <tr key={s.name} style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
              <td style={{ fontSize: 12, color: TEXT_PRI, padding: '5px 0' }}>{s.name}</td>
              <td style={{ fontSize: 11, color: TEXT_SEC, padding: '5px 4px', textAlign: 'right' }}>
                {s.value != null ? s.value.toFixed(2) : '—'}
              </td>
              <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', width: 68 }}>
                <SignalChip signal={s.signal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TechnicalsTab({ data, loading }: { data: TechnicalsData | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, gap: 8, color: TEXT_SEC, fontSize: 13 }}>
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140, color: TEXT_SEC, fontSize: 13 }}>
        No technical data available.
      </div>
    );
  }
  return (
    <div>
      <SummaryGauge buy={data.summary.buy} neutral={data.summary.neutral} sell={data.summary.sell} />
      <SignalTable title="Oscillators" signals={data.oscillators} />
      <SignalTable title="Moving Averages" signals={data.movingAverages} />
    </div>
  );
}

// ─── Analyst Tab ──────────────────────────────────────────────────────────────

const CONSENSUS_COLOR: Record<string, string> = {
  'Strong Buy': GREEN,
  'Buy': GREEN,
  'Hold': '#f59e0b',
  'Sell': RED,
  'Strong Sell': RED,
};

function ConsensusGauge({ consensus }: { consensus: RatingsConsensus }) {
  const { strongBuy, buy, hold, sell, strongSell, consensus: label } = consensus;
  const total = strongBuy + buy + hold + sell + strongSell || 1;
  const segments = [
    { label: 'Strong Buy', count: strongBuy, color: GREEN },
    { label: 'Buy', count: buy, color: '#22c55e' },
    { label: 'Hold', count: hold, color: '#f59e0b' },
    { label: 'Sell', count: sell, color: '#f97316' },
    { label: 'Strong Sell', count: strongSell, color: RED },
  ];
  const consensusLabel = label || 'Hold';
  const consensusColor = CONSENSUS_COLOR[consensusLabel] ?? TEXT_SEC;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: consensusColor }}>{consensusLabel}</div>
        <div style={{ fontSize: 11, color: TEXT_SEC, marginTop: 2 }}>Analyst Consensus</div>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
        {segments.map(seg => seg.count > 0 && (
          <div
            key={seg.label}
            style={{ flex: (seg.count / total) * 100, backgroundColor: seg.color, minWidth: 2 }}
            title={`${seg.label}: ${seg.count}`}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: seg.color }}>{seg.count}</div>
            <div style={{ fontSize: 9, color: TEXT_SEC, whiteSpace: 'nowrap' }}>{seg.label.replace('Strong ', 'Str. ')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriceTargetBar({ targets, currentPrice }: { targets: PriceTargets; currentPrice?: number }) {
  const { targetLow, targetHigh, targetConsensus } = targets;
  if (targetLow == null || targetHigh == null) return null;

  const range = targetHigh - targetLow;
  if (range <= 0) return null;

  const pct = (val: number) => Math.max(0, Math.min(100, ((val - targetLow) / range) * 100));

  const upside =
    currentPrice && targetConsensus
      ? ((targetConsensus - currentPrice) / currentPrice) * 100
      : null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_SEC, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 10 }}>
        Price Target
      </div>
      <div style={{ position: 'relative', height: 20, marginBottom: 6 }}>
        {/* Track */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0, height: 4,
          transform: 'translateY(-50%)', backgroundColor: 'var(--color-border-default)', borderRadius: 2,
        }} />
        {/* Consensus marker */}
        {targetConsensus != null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: `${pct(targetConsensus)}%`,
            width: 2, backgroundColor: TEXT_SEC, transform: 'translateX(-50%)',
          }} title={`Consensus: $${targetConsensus.toFixed(2)}`} />
        )}
        {/* Current price marker */}
        {currentPrice != null && currentPrice >= targetLow && currentPrice <= targetHigh && (
          <div style={{
            position: 'absolute', top: '50%', left: `${pct(currentPrice)}%`,
            transform: 'translate(-50%, -50%)',
            width: 10, height: 10, borderRadius: '50%',
            backgroundColor: 'var(--color-bg-card)',
            border: '2px solid var(--color-text-primary)',
          }} title={`Current: $${currentPrice.toFixed(2)}`} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: TEXT_SEC }}>${targetLow.toFixed(2)}<br /><span style={{ fontSize: 9, opacity: 0.7 }}>Low</span></span>
        {targetConsensus != null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 600, color: TEXT_PRI }}>${targetConsensus.toFixed(2)}</div>
            {upside != null && (
              <div style={{ fontSize: 10, color: upside >= 0 ? GREEN : RED }}>
                {upside >= 0 ? '+' : ''}{upside.toFixed(1)}% upside
              </div>
            )}
          </div>
        )}
        <span style={{ color: TEXT_SEC, textAlign: 'right' }}>${targetHigh.toFixed(2)}<br /><span style={{ fontSize: 9, opacity: 0.7 }}>High</span></span>
      </div>
    </div>
  );
}

const ACTION_COLOR: Record<string, string> = {
  upgrade: GREEN,
  downgrade: RED,
  initiated: '#60a5fa',
  maintained: TEXT_SEC,
  reiterated: TEXT_SEC,
};

function AnalystGradesList({ grades }: { grades: AnalystGrade[] }) {
  if (!grades.length) return null;
  const shown = grades.slice(0, 8);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_SEC, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
        Recent Ratings
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {shown.map((g, i) => {
            const action = g.action?.toLowerCase() ?? 'maintained';
            const actionColor = ACTION_COLOR[action] ?? TEXT_SEC;
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border-muted)' }}>
                <td style={{ fontSize: 11, color: TEXT_SEC, padding: '5px 0', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {g.date ?? ''}
                </td>
                <td style={{ fontSize: 11, color: TEXT_PRI, padding: '5px 0', paddingRight: 8 }}>
                  {g.company ?? ''}
                </td>
                <td style={{ fontSize: 10, color: TEXT_SEC, padding: '5px 0' }}>
                  {g.previousGrade && g.newGrade ? (
                    <span>{g.previousGrade} → <span style={{ color: TEXT_PRI }}>{g.newGrade}</span></span>
                  ) : (
                    g.newGrade ?? g.previousGrade ?? '—'
                  )}
                </td>
                <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: actionColor }}>{g.action ?? '—'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnalystTab({ data, currentPrice }: { data: AnalystData | null; currentPrice?: number }) {
  if (!data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140, color: TEXT_SEC, fontSize: 13 }}>
        No analyst data available.
      </div>
    );
  }
  return (
    <div>
      {data.ratingsConsensus && <ConsensusGauge consensus={data.ratingsConsensus} />}
      {data.priceTargets && <PriceTargetBar targets={data.priceTargets} currentPrice={currentPrice} />}
      <AnalystGradesList grades={data.grades ?? []} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CompanyOverviewPanel({
  symbol: _symbol,
  visible,
  onClose,
  data,
  loading,
  analystData,
  technicalData,
  technicalLoading,
}: CompanyOverviewPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  if (!visible) return null;

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'technicals', label: 'Technicals' },
    { id: 'analyst', label: 'Analyst' },
  ];

  const currentPrice = (data as OverviewData | null)?.quote?.price as number | undefined;

  return (
    <div className="company-overview-panel">
      <div className="company-overview-header">
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, backgroundColor: 'var(--color-bg-tag)', borderRadius: 7, padding: 3 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeTab === tab.id ? 'var(--color-bg-elevated)' : 'transparent',
                color: activeTab === tab.id ? TEXT_PRI : TEXT_SEC,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="company-overview-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <>
          {loading && (
            <div className="company-overview-loading">
              <Loader2 size={16} className="animate-spin" />
              Loading...
            </div>
          )}
          {!data && !loading && (
            <div className="company-overview-error">No data available</div>
          )}
          {data && !loading && <OverviewTab data={data} />}
        </>
      )}

      {/* Technicals tab */}
      {activeTab === 'technicals' && (
        <TechnicalsTab data={technicalData ?? null} loading={technicalLoading ?? false} />
      )}

      {/* Analyst tab */}
      {activeTab === 'analyst' && (
        <AnalystTab data={analystData ?? null} currentPrice={currentPrice} />
      )}
    </div>
  );
}
