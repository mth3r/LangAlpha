"""Strategy service: Pine Script → Python translation + signal execution + backtest."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_TRANSLATION_SYSTEM_PROMPT = """You are an expert quantitative analyst who translates TradingView Pine Script v5 strategies into Python.

Translate the given Pine Script into a Python function with this exact signature:

```python
def compute_signals(df):
    # df is a pandas DataFrame with columns: open, high, low, close, volume
    # Index is a DatetimeIndex in UTC
    # Returns a list of dicts: [{"timestamp": ISO-string, "action": "buy"|"sell", "price": float}, ...]
    ...
```

Rules:
- Use only pandas (imported as pd) and pandas_ta (imported as ta) — no other imports
- Map Pine Script indicators to pandas_ta equivalents (sma → ta.sma, rsi → ta.rsi, ema → ta.ema, etc.)
- Preserve all crossover/crossunder logic faithfully
- Return signals only when a condition fires (not every bar)
- Use df.index[i].isoformat() for timestamps
- Use df['close'].iloc[i] for prices unless the script specifies entry price differently
- If the script has both strategy.entry(long) and strategy.entry(short), map to "buy" and "sell"
- If only one direction, still use "buy" for long entries and "sell" for exits/short entries
"""

_TRANSLATION_USER_TEMPLATE = """Translate this Pine Script to Python:

```pine
{pine_script}
```

Return ONLY the Python function code (no markdown, no explanation outside the code)."""

_COMMENTARY_SYSTEM_PROMPT = """You are a quantitative trading analyst. Given a strategy's backtest results, provide a brief, honest assessment.
Be concise (2-3 sentences). Highlight the most important metric and any obvious concerns."""


async def translate_pine_to_python(pine_script: str) -> tuple[str, str]:
    """Translate Pine Script to Python using Gemini. Returns (python_code, description)."""
    from src.llms import create_llm
    from src.llms.api_call import make_api_call
    from src.server.models.strategy import TranslationOutput
    from src.server.app import setup

    config = setup.agent_config
    flash_model = config.llm.flash if config and config.llm else "gemini-2.0-flash"

    llm = create_llm(flash_model)
    result = await make_api_call(
        llm,
        system_prompt=_TRANSLATION_SYSTEM_PROMPT,
        user_prompt=_TRANSLATION_USER_TEMPLATE.format(pine_script=pine_script),
        response_schema=TranslationOutput,
    )

    if hasattr(result, "python_code"):
        return result.python_code, result.description
    # Fallback: raw string response
    return str(result), "Translated from Pine Script"


async def run_strategy(
    python_code: str,
    symbol: str,
    interval: str = "1d",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute translated Python strategy against historical OHLCV data."""
    import pandas as pd
    from datetime import datetime, timedelta, timezone

    # Always fetch 2 years of data before from_date for indicator warmup.
    # Signals are then filtered to the user-requested window.
    warmup_start: Optional[str] = None
    if from_date:
        try:
            dt = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            warmup_start = (dt - timedelta(days=730)).strftime("%Y-%m-%d")
        except ValueError:
            warmup_start = None

    df = await _fetch_ohlcv(symbol, interval, warmup_start or from_date, to_date)
    if df is None or df.empty:
        return {"signals": [], "stats": _empty_stats()}

    # Execute strategy on full dataset (warmup included)
    signals = await asyncio.to_thread(_exec_strategy, python_code, df)

    # Filter signals to the user-requested date window
    if from_date:
        try:
            cutoff = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            if cutoff.tzinfo is None:
                cutoff = cutoff.replace(tzinfo=timezone.utc)
            signals = [
                s for s in signals
                if datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00")).replace(tzinfo=timezone.utc) >= cutoff
            ]
        except (ValueError, KeyError):
            pass

    # Compute backtest stats
    stats = _compute_stats(signals, df)

    return {"signals": signals, "stats": stats}


async def generate_commentary(
    stats: Dict[str, Any],
    strategy_name: str,
    symbol: str,
) -> str:
    """Generate AI commentary on backtest results."""
    try:
        from src.llms import create_llm
        from src.llms.api_call import make_api_call
        from src.server.app import setup

        config = setup.agent_config
        flash_model = config.llm.flash if config and config.llm else "gemini-2.0-flash"

        prompt = (
            f"Strategy: {strategy_name} | Symbol: {symbol}\n"
            f"Trades: {stats.get('total_trades', 0)} | "
            f"Win rate: {stats.get('win_rate', 'N/A')} | "
            f"Total return: {stats.get('total_return_pct', 'N/A')}% | "
            f"Max drawdown: {stats.get('max_drawdown_pct', 'N/A')}%"
        )

        llm = create_llm(flash_model)
        result = await make_api_call(
            llm,
            system_prompt=_COMMENTARY_SYSTEM_PROMPT,
            user_prompt=prompt,
        )
        return str(result) if result else ""
    except Exception:
        logger.warning("Failed to generate strategy commentary", exc_info=True)
        return ""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _fetch_ohlcv(
    symbol: str,
    interval: str,
    from_date: Optional[str],
    to_date: Optional[str],
) -> Optional[Any]:
    """Fetch OHLCV data from yfinance."""
    import yfinance as yf
    import pandas as pd

    # Map interval to yfinance period/interval
    yf_interval_map = {
        "1d": "1d", "1w": "1wk", "1mo": "1mo",
        "1h": "1h", "4h": "4h", "30m": "30m", "15m": "15m", "5m": "5m",
    }
    yf_interval = yf_interval_map.get(interval, "1d")

    def _fetch():
        ticker = yf.Ticker(symbol)
        kwargs: dict = {"interval": yf_interval, "auto_adjust": True}
        if from_date:
            kwargs["start"] = from_date
        if to_date:
            kwargs["end"] = to_date
        if not from_date and not to_date:
            kwargs["period"] = "2y"
        df = ticker.history(**kwargs)
        if df.empty:
            return None
        df.columns = [c.lower() for c in df.columns]
        df.index = pd.to_datetime(df.index, utc=True)
        return df[["open", "high", "low", "close", "volume"]]

    try:
        return await asyncio.to_thread(_fetch)
    except Exception:
        logger.warning("Failed to fetch OHLCV for %s", symbol, exc_info=True)
        return None


def _exec_strategy(python_code: str, df: Any) -> List[Dict[str, Any]]:
    """Execute translated Python strategy in a restricted namespace."""
    import pandas as pd
    try:
        import pandas_ta as ta
    except ImportError:
        ta = None

    namespace: dict = {"pd": pd, "df": df, "__builtins__": __builtins__}
    if ta is not None:
        namespace["ta"] = ta

    try:
        exec(python_code, namespace)  # noqa: S102
        compute_signals = namespace.get("compute_signals")
        if not callable(compute_signals):
            logger.error("Translated code did not define compute_signals()")
            return []
        result = compute_signals(df)
        if not isinstance(result, list):
            return []
        # Normalise each signal
        signals = []
        for s in result:
            if isinstance(s, dict) and "timestamp" in s and "action" in s and "price" in s:
                signals.append({
                    "timestamp": str(s["timestamp"]),
                    "action": str(s["action"]),
                    "price": float(s["price"]),
                })
        return signals
    except Exception:
        logger.error("Strategy execution failed", exc_info=True)
        return []


def _compute_stats(signals: List[Dict[str, Any]], df: Any) -> Dict[str, Any]:
    """Compute simple backtest statistics from a list of signals."""
    buys = [s for s in signals if s["action"] == "buy"]
    sells = [s for s in signals if s["action"] == "sell"]
    total = len(signals)

    if total == 0:
        return _empty_stats()

    # Pair up buy→sell trades to compute P&L per trade
    trades = []
    buy_stack = []
    for s in sorted(signals, key=lambda x: x["timestamp"]):
        if s["action"] == "buy":
            buy_stack.append(s["price"])
        elif s["action"] == "sell" and buy_stack:
            entry = buy_stack.pop(0)
            pnl = (s["price"] - entry) / entry * 100
            trades.append(pnl)

    wins = [t for t in trades if t > 0]
    win_rate = round(len(wins) / len(trades) * 100, 1) if trades else None
    total_return = round(sum(trades), 2) if trades else None

    # Simple max drawdown from trade P&Ls
    max_dd = None
    if trades:
        cum = 0.0
        peak = 0.0
        dd = 0.0
        for t in trades:
            cum += t
            if cum > peak:
                peak = cum
            drawdown = peak - cum
            if drawdown > dd:
                dd = drawdown
        max_dd = round(-dd, 2) if dd > 0 else 0.0

    return {
        "total_trades": total,
        "buy_signals": len(buys),
        "sell_signals": len(sells),
        "win_rate": win_rate,
        "total_return_pct": total_return,
        "max_drawdown_pct": max_dd,
    }


def _empty_stats() -> Dict[str, Any]:
    return {
        "total_trades": 0,
        "buy_signals": 0,
        "sell_signals": 0,
        "win_rate": None,
        "total_return_pct": None,
        "max_drawdown_pct": None,
    }
