import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePortfolioData } from '../Dashboard/hooks/usePortfolioData';
import { getYtdStartPrice } from '../Dashboard/utils/api';
import type { PortfolioPerformancePeriod } from '../Dashboard/utils/api';
import { fetchAnalystData } from '../MarketView/utils/api';
import PortfolioSummaryCards from './components/PortfolioSummaryCards';
import PortfolioPerformanceChart from './components/PortfolioPerformanceChart';
import PortfolioTable from './components/PortfolioTable';
import TickerChartModal from './components/TickerChartModal';
import ScreenerControls from './components/ScreenerControls';
import type { ScreenerConfig } from './components/ScreenerControls';
import ConsensusDashboard from './components/ConsensusDashboard';
import type { TickerResult } from './components/ConsensusDashboard';
import './Portfolio.css';

interface AnalystEntry {
  consensus: string | null;
  targetConsensus: number | null;
}

export default function Portfolio() {
  const { rows, loading } = usePortfolioData();
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [perfPeriod, setPerfPeriod] = useState<PortfolioPerformancePeriod>('1Y');

  // Screener state
  const [screenerConfig, setScreenerConfig] = useState<ScreenerConfig>({
    activeScreeners: ['hhma'],
    requireUnanimous: true,
    hhmaLength: 21,
    rsiPeriod: 14,
  });
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<TickerResult[]>([]);
  const [lastScreenerIds, setLastScreenerIds] = useState<string[]>([]);
  const [lastRequireUnanimous, setLastRequireUnanimous] = useState(true);

  const handleScan = useCallback(async () => {
    const symbols = rows.map((r) => r.symbol);
    if (symbols.length === 0) return;
    setScanLoading(true);
    try {
      const res = await fetch('/api/v1/screening/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols,
          screener_ids: screenerConfig.activeScreeners,
          require_unanimous: screenerConfig.requireUnanimous,
          hhma_length: screenerConfig.hhmaLength,
          rsi_period: screenerConfig.rsiPeriod,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setScanResults(data.results ?? []);
      setLastScreenerIds(data.screener_ids ?? screenerConfig.activeScreeners);
      setLastRequireUnanimous(data.require_unanimous ?? screenerConfig.requireUnanimous);
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setScanLoading(false);
    }
  }, [rows, screenerConfig]);

  const symbols = rows.map((r) => r.symbol);

  const { data: ytdPriceMap = {} } = useQuery<Record<string, number | null>>({
    queryKey: ['ytdPrices', symbols.join(',')],
    queryFn: async () => {
      const map: Record<string, number | null> = {};
      await Promise.all(symbols.map(async (sym) => {
        map[sym] = await getYtdStartPrice(sym);
      }));
      return map;
    },
    enabled: symbols.length > 0,
    staleTime: 1000 * 60 * 60,
  });

  const { data: analystMap = {} } = useQuery<Record<string, AnalystEntry>>({
    queryKey: ['portfolioAnalyst', symbols.join(',')],
    queryFn: async () => {
      const map: Record<string, AnalystEntry> = {};
      await Promise.allSettled(
        symbols.map(async (sym) => {
          try {
            const res = await fetchAnalystData(sym) as Record<string, unknown> | null;
            if (!res) return;
            const consensus = (res.ratingsConsensus as Record<string, unknown> | null)?.consensus as string | null ?? null;
            const targetConsensus = (res.priceTargets as Record<string, unknown> | null)?.targetConsensus as number | null ?? null;
            map[sym] = { consensus, targetConsensus };
          } catch {
            // leave missing
          }
        })
      );
      return map;
    },
    enabled: symbols.length > 0,
    staleTime: 15 * 60 * 1000,
  });

  return (
    <div className="portfolio-page">
      <div className="portfolio-content">
        <h1 className="portfolio-heading">Portfolio</h1>

        {loading ? (
          <div className="portfolio-skeleton">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="dashboard-glass-card p-4 h-24 animate-pulse" />
              ))}
            </div>
            <div className="dashboard-glass-card h-64 animate-pulse" />
          </div>
        ) : (
          <div className="portfolio-body">
            <PortfolioSummaryCards rows={rows} ytdPriceMap={ytdPriceMap} />
            <PortfolioPerformanceChart period={perfPeriod} onPeriodChange={setPerfPeriod} />
            <PortfolioTable
              rows={rows}
              ytdPriceMap={ytdPriceMap}
              analystMap={analystMap}
              onRowClick={setChartSymbol}
            />
            <ScreenerControls
              config={screenerConfig}
              onChange={setScreenerConfig}
              loading={scanLoading}
              onScan={handleScan}
            />
            {scanResults.length > 0 && (
              <ConsensusDashboard
                results={scanResults}
                screenerIds={lastScreenerIds}
                requireUnanimous={lastRequireUnanimous}
              />
            )}
          </div>
        )}
      </div>

      <TickerChartModal
        symbol={chartSymbol}
        onClose={() => setChartSymbol(null)}
      />
    </div>
  );
}
