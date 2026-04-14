import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePortfolioData } from '../Dashboard/hooks/usePortfolioData';
import { getYtdStartPrice } from '../Dashboard/utils/api';
import PortfolioSummaryCards from './components/PortfolioSummaryCards';
import PortfolioTable from './components/PortfolioTable';
import TickerChartModal from './components/TickerChartModal';
import './Portfolio.css';

export default function Portfolio() {
  const { rows, loading } = usePortfolioData();
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

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
            <PortfolioTable
              rows={rows}
              ytdPriceMap={ytdPriceMap}
              onRowClick={setChartSymbol}
            />
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
