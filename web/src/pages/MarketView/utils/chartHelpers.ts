export interface OHLCDataPoint {
  time: number;
  close: number;
  [key: string]: unknown;
}

export interface TimeValuePoint {
  time: number;
  value: number;
}

export interface RSIState {
  avgGain: number;
  avgLoss: number;
  lastClose: number;
  period: number;
}

export interface RSIResult {
  data: TimeValuePoint[];
  state: RSIState | null;
}

export interface RSIIncrementalResult {
  value: number;
  state: RSIState;
}

/**
 * Sliding-window Simple Moving Average — O(n)
 */
export function calculateMA(data: OHLCDataPoint[], period: number): TimeValuePoint[] {
  if (data.length < period) return [];
  const result: TimeValuePoint[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  result.push({ time: data[period - 1].time, value: sum / period });
  for (let i = period; i < data.length; i++) {
    sum += data[i].close - data[i - period].close;
    const value = sum / period;
    if (!isNaN(value) && isFinite(value)) {
      result.push({ time: data[i].time, value });
    }
  }
  return result;
}

/**
 * Wilder's smoothed RSI — O(n), correct algorithm.
 * Returns { data: [{ time, value }], state: { avgGain, avgLoss, lastClose, period } }
 * so live ticks can continue incrementally via updateRSIIncremental().
 */
export function calculateRSI(data: OHLCDataPoint[], period: number = 14): RSIResult {
  if (data.length < period + 1) return { data: [], state: null };
  const result: TimeValuePoint[] = [];

  // Calculate price changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const firstRSI = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRS);
  result.push({ time: data[period].time, value: firstRSI });

  // Wilder's exponential smoothing for subsequent values
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    if (!isNaN(rsi) && isFinite(rsi)) {
      result.push({ time: data[i].time, value: rsi });
    }
  }

  return {
    data: result,
    state: { avgGain, avgLoss, lastClose: data[data.length - 1].close, period },
  };
}

export type HHMASignal = 'bullish' | 'bearish' | 'neutral';

export interface HHMAPoint extends TimeValuePoint {
  signal: HHMASignal;
}

/**
 * Hyperbolic Hull Moving Average — O(n * length)
 *
 * Port of the QuantAlgo TradingView Pine Script:
 *   sinhWMA = weighted MA using sinh((length-i)/length) weights
 *   raw     = 2 * sinhWMA(close, length/2) - sinhWMA(close, length)
 *   HHMA    = sinhWMA(raw, sqrt(length))
 *
 * Each point is tagged with a slope signal (bullish / bearish / neutral).
 */
export function calculateHHMA(data: OHLCDataPoint[], length: number = 21): HHMAPoint[] {
  const half = Math.round(length / 2);
  const sqrtLen = Math.round(Math.sqrt(length));

  function sinhWMA(closes: number[], endIdx: number, len: number): number {
    let sumW = 0;
    let sumV = 0;
    for (let j = 0; j < len; j++) {
      const w = Math.sinh((len - j) / len);
      sumW += w;
      sumV += closes[endIdx - j] * w;
    }
    return sumV / sumW;
  }

  if (data.length < length + sqrtLen) return [];

  const closes = data.map((d) => d.close);

  // Stage 1: compute raw = 2*sinhWMA(half) - sinhWMA(length) for every bar >= length-1
  const raw: number[] = [];
  const rawTimes: number[] = [];
  for (let i = length - 1; i < data.length; i++) {
    raw.push(2 * sinhWMA(closes, i, half) - sinhWMA(closes, i, length));
    rawTimes.push(data[i].time);
  }

  // Stage 2: apply sinhWMA(sqrtLen) to raw series
  if (raw.length < sqrtLen) return [];

  const result: HHMAPoint[] = [];
  for (let i = sqrtLen - 1; i < raw.length; i++) {
    let sumW = 0;
    let sumV = 0;
    for (let j = 0; j < sqrtLen; j++) {
      const w = Math.sinh((sqrtLen - j) / sqrtLen);
      sumW += w;
      sumV += raw[i - j] * w;
    }
    const value = sumV / sumW;
    const prev = result.length > 0 ? result[result.length - 1].value : null;
    const signal: HHMASignal =
      prev === null ? 'neutral' : value > prev ? 'bullish' : value < prev ? 'bearish' : 'neutral';
    result.push({ time: rawTimes[i], value, signal });
  }

  return result;
}

/**
 * O(1) incremental RSI update for a single new bar.
 * @param prevState — from calculateRSI().state or a prior call
 * @param newClose — the new bar's close price
 * @returns { value, state } for chaining
 */
export function updateRSIIncremental(prevState: RSIState, newClose: number): RSIIncrementalResult {
  const { avgGain: prevAvgGain, avgLoss: prevAvgLoss, lastClose, period } = prevState;
  const change = newClose - lastClose;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;
  const avgGain = (prevAvgGain * (period - 1) + gain) / period;
  const avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  return { value, state: { avgGain, avgLoss, lastClose: newClose, period } };
}
