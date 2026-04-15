# HHMA Strategy + Portfolio Screener

**Reference**: https://www.tradingview.com/script/532dzfsg-Hyperbolic-Hull-Moving-Average-HHMA-QuantAlgo/

## Algo Summary

- Hull MA of a Hull MA using a hyperbolic sine weighting kernel instead of WMA
- Signal: bullish when HHMA slope turns up (green), bearish when slope turns down (red)
- Entry: long on upward flip, exit on downward flip

---

## Implementation Status

### 1. Indicator Implementation ✅
- [x] **HHMA calc in TypeScript** (`web/src/pages/MarketView/utils/chartHelpers.ts`)
  - `calculateHHMA(data, length)` → `HHMAPoint[]` (each point tagged with `signal: 'bullish' | 'bearish' | 'neutral'`)
  - sinh weighting kernel, two-stage HMA with `sqrt(length)` smoothing
- [x] **HHMA constants** (`web/src/pages/MarketView/utils/chartConstants.ts`)
  - `HHMA_COLOR_BULL`, `HHMA_COLOR_BEAR`, `HHMA_DEFAULT_LENGTH`
- [x] **API endpoint** (`src/server/app/screening.py`)
  - `GET  /api/v1/screening/screeners` — list available screeners
  - `POST /api/v1/screening/scan` — run consensus scan across tickers
- [x] **HHMA strategy signals** (`src/tools/screening/engine.py`)
  - `HHMAScreener` — slope-based BUY/SELL
  - `RSIScreener` — oversold/overbought
  - `VolumeScreener` — surge with directional confirmation
  - `ConsensusFilter` — unanimous or majority consensus

### 2. UI & Visualization ✅
- [x] **HHMA overlay on `MarketChart.tsx`**
  - Two line series (bull=green / bear=red) split at slope transition points, anchored for visual continuity
  - Toggle in Indicators dropdown; length choices: 14 / 21 / 50
  - Current value + ▲/▼ signal displayed in indicator values bar
- [x] **Persisted** via `loadPref`/`savePref` (showHHMA, hhmaLength)

### 3. Multi-Screener Engine ✅
- [x] `src/tools/screening/__init__.py`
- [x] `src/tools/screening/engine.py` — `BaseScreener`, `HHMAScreener`, `RSIScreener`, `VolumeScreener`, `ConsensusFilter`, `build_screener`
- [x] `src/server/app/screening.py` — FastAPI router registered in `setup.py`

### 4. Advanced UI Controls ✅
- [x] `web/src/pages/Portfolio/components/ScreenerControls.tsx` — screener toggle + universal consensus checkbox + param inputs
- [x] `web/src/pages/Portfolio/components/ConsensusDashboard.tsx` — action list table + per-screener signal badges + neutral collapsible
- [x] `web/src/pages/Portfolio/Portfolio.tsx` — wired scan fetch, results state, renders controls + dashboard below portfolio table
