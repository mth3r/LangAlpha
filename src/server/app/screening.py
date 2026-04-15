"""
Screening API Router.

Endpoints:
- GET  /api/v1/screening/screeners  — list available screener modules
- POST /api/v1/screening/scan       — run multi-screener consensus across a set of tickers
"""

import asyncio
import logging
from typing import Optional

import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.server.utils.api import CurrentUserId
from src.tools.screening.engine import (
    AVAILABLE_SCREENERS,
    ConsensusFilter,
    build_screener,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/screening", tags=["Screening"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ScanRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=1, max_length=100, description="Ticker symbols to scan")
    screener_ids: list[str] = Field(
        default=["hhma", "rsi", "volume"],
        description="Screener modules to activate",
    )
    require_unanimous: bool = Field(True, description="Only surface tickers where all screeners agree")
    # Per-screener config
    hhma_length: int = Field(21, ge=5, le=200)
    rsi_period: int = Field(14, ge=2, le=100)
    rsi_oversold: float = Field(30.0, ge=0, le=50)
    rsi_overbought: float = Field(70.0, ge=50, le=100)
    volume_lookback: int = Field(20, ge=5, le=200)
    volume_multiplier: float = Field(1.5, ge=1.0, le=10.0)
    # Data config
    history_days: int = Field(365, ge=30, le=1825, description="Days of history to fetch per ticker")


class TickerResult(BaseModel):
    symbol: str
    signals: dict[str, str]
    consensus: str
    latest_close: Optional[float] = None
    error: Optional[str] = None


class ScanResponse(BaseModel):
    screener_ids: list[str]
    require_unanimous: bool
    results: list[TickerResult]
    action_list: list[TickerResult] = Field(
        description="Tickers with a non-NEUTRAL consensus (BUY or SELL)"
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _fetch_closes_volumes(symbol: str, days: int) -> tuple[list[float], list[float]]:
    """Fetch daily close + volume via yfinance in a thread."""
    def _fetch():
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=f"{days}d", interval="1d", auto_adjust=True)
        if df.empty:
            return [], []
        closes = df["Close"].tolist()
        volumes = df["Volume"].tolist()
        return closes, volumes

    try:
        return await asyncio.to_thread(_fetch)
    except Exception:
        logger.warning("Failed to fetch data for %s", symbol, exc_info=True)
        return [], []


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/screeners")
async def list_screeners(_user_id: CurrentUserId):
    """Return metadata for all available screener modules."""
    return {"screeners": AVAILABLE_SCREENERS}


@router.post("/scan", response_model=ScanResponse)
async def scan_portfolio(body: ScanRequest, _user_id: CurrentUserId):
    """
    Run the selected screeners across the given symbols and return consensus signals.

    With `require_unanimous=true`, the `action_list` contains only tickers where
    *every* active screener returns the same BUY or SELL signal.
    """
    # Validate screener IDs
    unknown = [sid for sid in body.screener_ids if sid not in {"hhma", "rsi", "volume"}]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown screener(s): {unknown}")

    # Build screeners
    screener_kwargs: dict[str, dict] = {
        "hhma": {"length": body.hhma_length},
        "rsi": {"period": body.rsi_period, "oversold": body.rsi_oversold, "overbought": body.rsi_overbought},
        "volume": {"lookback": body.volume_lookback, "multiplier": body.volume_multiplier},
    }
    try:
        screeners = [build_screener(sid, **screener_kwargs[sid]) for sid in body.screener_ids]
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    cf = ConsensusFilter(screeners, require_unanimous=body.require_unanimous)

    # Fetch data concurrently
    fetch_tasks = [_fetch_closes_volumes(sym, body.history_days) for sym in body.symbols]
    fetched = await asyncio.gather(*fetch_tasks, return_exceptions=True)

    results: list[TickerResult] = []
    for symbol, data in zip(body.symbols, fetched):
        if isinstance(data, Exception):
            results.append(TickerResult(symbol=symbol, signals={}, consensus="NEUTRAL", error=str(data)))
            continue

        closes, volumes = data
        if not closes:
            results.append(TickerResult(symbol=symbol, signals={}, consensus="NEUTRAL", error="No data returned"))
            continue

        evaluation = cf.evaluate_ticker(closes, volumes)
        results.append(TickerResult(
            symbol=symbol,
            signals={k: str(v) for k, v in evaluation["signals"].items()},  # type: ignore[union-attr]
            consensus=str(evaluation["consensus"]),
            latest_close=round(closes[-1], 2) if closes else None,
        ))

    action_list = [r for r in results if r.consensus in ("BUY", "SELL")]

    return ScanResponse(
        screener_ids=body.screener_ids,
        require_unanimous=body.require_unanimous,
        results=results,
        action_list=action_list,
    )
