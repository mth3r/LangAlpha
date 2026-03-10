"""Shared OHLCV bar normalization.

Single source of truth for converting the canonical
``{time, open, high, low, close, volume}`` shape to display format with
exchange-local timestamps.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .market_data_provider import symbol_timezone


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_bars(
    bars: list[dict],
    symbol: str,
    *,
    intraday: bool = False,
) -> list[dict]:
    """Convert bars from internal format (Unix ms) to display format.

    Timestamps are converted to exchange-local time for the given symbol.
    Output: ``{date, open, high, low, close, volume}``, descending by date.
    """
    tz = symbol_timezone(symbol)
    normalized = []
    for bar in bars:
        ts = bar.get("time") or bar.get("t")
        if ts is not None:
            dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).astimezone(tz)
            fmt = "%Y-%m-%d %H:%M:%S" if intraday else "%Y-%m-%d"
            date_str = dt.strftime(fmt)
        else:
            date_str = bar.get("date", "")
        normalized.append({
            "date": date_str,
            "open": _as_float(bar.get("open") or bar.get("o")),
            "high": _as_float(bar.get("high") or bar.get("h")),
            "low": _as_float(bar.get("low") or bar.get("l")),
            "close": _as_float(bar.get("close") or bar.get("c")),
            "volume": _as_float(bar.get("volume") or bar.get("v")),
        })
    normalized.sort(key=lambda r: r["date"], reverse=True)
    return normalized
