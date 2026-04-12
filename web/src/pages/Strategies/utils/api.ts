/**
 * Strategies API utilities
 */
import { api } from '@/api/client';

export interface Strategy {
  strategy_id: string;
  user_id: string;
  name: string;
  pine_script: string;
  python_code?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalPoint {
  timestamp: string;
  action: 'buy' | 'sell';
  price: number;
}

export interface BacktestStats {
  total_trades: number;
  buy_signals: number;
  sell_signals: number;
  win_rate: number | null;
  total_return_pct: number | null;
  max_drawdown_pct: number | null;
}

export interface RunStrategyResult {
  strategy_id: string;
  symbol: string;
  interval: string;
  signals: SignalPoint[];
  stats: BacktestStats;
  ai_commentary: string | null;
}

export async function listStrategies(): Promise<Strategy[]> {
  const res = await api.get('/api/v1/strategies');
  return res.data.strategies;
}

export async function createStrategy(name: string, pine_script: string): Promise<Strategy> {
  const res = await api.post('/api/v1/strategies', { name, pine_script });
  return res.data;
}

export async function updateStrategy(
  strategyId: string,
  fields: { name?: string; pine_script?: string }
): Promise<Strategy> {
  const res = await api.put(`/api/v1/strategies/${strategyId}`, fields);
  return res.data;
}

export async function deleteStrategy(strategyId: string): Promise<void> {
  await api.delete(`/api/v1/strategies/${strategyId}`);
}

export async function runStrategy(
  strategyId: string,
  symbol: string,
  interval: string,
  from_date?: string,
  to_date?: string
): Promise<RunStrategyResult> {
  const res = await api.post(`/api/v1/strategies/${strategyId}/run`, {
    symbol,
    interval,
    from_date: from_date || null,
    to_date: to_date || null,
  });
  return res.data;
}
