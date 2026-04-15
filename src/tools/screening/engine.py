"""
Modular screening engine with pluggable screeners and consensus logic.

Each screener implements BaseScreener.evaluate() and returns "BUY", "SELL", or "NEUTRAL".
ConsensusFilter runs multiple screeners across tickers and returns only those where all
active screeners unanimously agree.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from typing import Literal

Signal = Literal["BUY", "SELL", "NEUTRAL"]


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------


class BaseScreener(ABC):
    """Common interface for all screeners."""

    screener_id: str  # must be set by subclass
    label: str        # human-readable name

    @abstractmethod
    def evaluate(self, closes: list[float], volumes: list[float]) -> Signal:
        """
        Evaluate a single ticker.

        Args:
            closes: Close prices, oldest-first, at least `min_bars` length.
            volumes: Volume values parallel to closes.

        Returns:
            "BUY" | "SELL" | "NEUTRAL"
        """

    @property
    def min_bars(self) -> int:
        """Minimum number of bars required for a valid signal."""
        return 1


# ---------------------------------------------------------------------------
# HHMA screener
# ---------------------------------------------------------------------------


class HHMAScreener(BaseScreener):
    """Generates signals from the Hyperbolic Hull Moving Average slope."""

    screener_id = "hhma"
    label = "HHMA"

    def __init__(self, length: int = 21) -> None:
        self.length = length

    @property
    def min_bars(self) -> int:
        return self.length + round(math.sqrt(self.length)) + 2

    def _sinh_wma(self, values: list[float], end: int, length: int) -> float:
        sum_w = 0.0
        sum_v = 0.0
        for j in range(length):
            w = math.sinh((length - j) / length)
            sum_w += w
            sum_v += values[end - j] * w
        return sum_v / sum_w

    def _compute_hhma(self, closes: list[float]) -> list[float]:
        half = round(self.length / 2)
        sqrt_len = round(math.sqrt(self.length))

        raw: list[float] = []
        for i in range(self.length - 1, len(closes)):
            raw.append(2 * self._sinh_wma(closes, i, half) - self._sinh_wma(closes, i, self.length))

        result: list[float] = []
        for i in range(sqrt_len - 1, len(raw)):
            sum_w = 0.0
            sum_v = 0.0
            for j in range(sqrt_len):
                w = math.sinh((sqrt_len - j) / sqrt_len)
                sum_w += w
                sum_v += raw[i - j] * w
            result.append(sum_v / sum_w)

        return result

    def evaluate(self, closes: list[float], volumes: list[float]) -> Signal:
        if len(closes) < self.min_bars:
            return "NEUTRAL"
        hhma = self._compute_hhma(closes)
        if len(hhma) < 2:
            return "NEUTRAL"
        if hhma[-1] > hhma[-2]:
            return "BUY"
        if hhma[-1] < hhma[-2]:
            return "SELL"
        return "NEUTRAL"


# ---------------------------------------------------------------------------
# RSI screener
# ---------------------------------------------------------------------------


class RSIScreener(BaseScreener):
    """Buy when RSI crosses above oversold; sell when it crosses below overbought."""

    screener_id = "rsi"
    label = "RSI"

    def __init__(self, period: int = 14, oversold: float = 30.0, overbought: float = 70.0) -> None:
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    @property
    def min_bars(self) -> int:
        return self.period + 2

    def _compute_rsi(self, closes: list[float]) -> float:
        period = self.period
        avg_gain = 0.0
        avg_loss = 0.0
        for i in range(1, period + 1):
            change = closes[i] - closes[i - 1]
            if change > 0:
                avg_gain += change
            else:
                avg_loss -= change
        avg_gain /= period
        avg_loss /= period

        for i in range(period + 1, len(closes)):
            change = closes[i] - closes[i - 1]
            gain = change if change > 0 else 0.0
            loss = -change if change < 0 else 0.0
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period

        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100 - 100 / (1 + rs)

    def evaluate(self, closes: list[float], volumes: list[float]) -> Signal:
        if len(closes) < self.min_bars:
            return "NEUTRAL"
        rsi = self._compute_rsi(closes)
        if rsi <= self.oversold:
            return "BUY"
        if rsi >= self.overbought:
            return "SELL"
        return "NEUTRAL"


# ---------------------------------------------------------------------------
# Volume screener
# ---------------------------------------------------------------------------


class VolumeScreener(BaseScreener):
    """Buy when today's volume exceeds the N-bar average by `multiplier`x with a green close."""

    screener_id = "volume"
    label = "Volume"

    def __init__(self, lookback: int = 20, multiplier: float = 1.5) -> None:
        self.lookback = lookback
        self.multiplier = multiplier

    @property
    def min_bars(self) -> int:
        return self.lookback + 1

    def evaluate(self, closes: list[float], volumes: list[float]) -> Signal:
        if len(closes) < self.min_bars or len(volumes) < self.min_bars:
            return "NEUTRAL"
        avg_vol = sum(volumes[-(self.lookback + 1):-1]) / self.lookback
        today_vol = volumes[-1]
        if avg_vol == 0:
            return "NEUTRAL"
        green = closes[-1] > closes[-2]
        red = closes[-1] < closes[-2]
        if today_vol >= avg_vol * self.multiplier and green:
            return "BUY"
        if today_vol >= avg_vol * self.multiplier and red:
            return "SELL"
        return "NEUTRAL"


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_SCREENER_REGISTRY: dict[str, type[BaseScreener]] = {
    cls.screener_id: cls  # type: ignore[attr-defined]
    for cls in [HHMAScreener, RSIScreener, VolumeScreener]
}

AVAILABLE_SCREENERS = [
    {"id": cls.screener_id, "label": cls.label}  # type: ignore[attr-defined]
    for cls in [HHMAScreener, RSIScreener, VolumeScreener]
]


def build_screener(screener_id: str, **kwargs: object) -> BaseScreener:
    cls = _SCREENER_REGISTRY.get(screener_id)
    if cls is None:
        raise ValueError(f"Unknown screener: {screener_id!r}")
    return cls(**kwargs)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Consensus filter
# ---------------------------------------------------------------------------


class ConsensusFilter:
    """
    Run multiple screeners across a set of tickers and apply consensus logic.

    With `require_unanimous=True` (default), only tickers where every screener
    returns the same non-NEUTRAL signal are included in the action list.
    """

    def __init__(self, screeners: list[BaseScreener], require_unanimous: bool = True) -> None:
        self.screeners = screeners
        self.require_unanimous = require_unanimous

    def evaluate_ticker(
        self,
        closes: list[float],
        volumes: list[float],
    ) -> dict[str, object]:
        """Return per-screener signals and the consensus signal."""
        per_screener: dict[str, Signal] = {}
        for s in self.screeners:
            per_screener[s.screener_id] = s.evaluate(closes, volumes)

        non_neutral = [v for v in per_screener.values() if v != "NEUTRAL"]
        if not non_neutral:
            consensus: Signal = "NEUTRAL"
        elif self.require_unanimous and len(set(non_neutral)) == 1 and len(non_neutral) == len(self.screeners):
            consensus = non_neutral[0]
        elif not self.require_unanimous:
            buys = non_neutral.count("BUY")
            sells = non_neutral.count("SELL")
            consensus = "BUY" if buys > sells else "SELL" if sells > buys else "NEUTRAL"
        else:
            consensus = "NEUTRAL"

        return {"signals": per_screener, "consensus": consensus}
