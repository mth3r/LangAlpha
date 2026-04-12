"""Pydantic models for the strategy tester feature."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class StrategyCreate(BaseModel):
    name: str
    pine_script: str


class StrategyUpdate(BaseModel):
    name: Optional[str] = None
    pine_script: Optional[str] = None


class StrategyResponse(BaseModel):
    strategy_id: str
    user_id: str
    name: str
    pine_script: str
    python_code: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class StrategiesListResponse(BaseModel):
    strategies: list[StrategyResponse]
    total: int


class SignalPoint(BaseModel):
    timestamp: str
    action: str  # "buy" | "sell"
    price: float


class BacktestStats(BaseModel):
    total_trades: int
    buy_signals: int
    sell_signals: int
    win_rate: Optional[float] = None
    total_return_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None


class RunStrategyRequest(BaseModel):
    symbol: str
    interval: str = "1d"
    from_date: Optional[str] = None
    to_date: Optional[str] = None


class RunStrategyResponse(BaseModel):
    strategy_id: str
    symbol: str
    interval: str
    signals: list[SignalPoint]
    stats: BacktestStats
    ai_commentary: Optional[str] = None


# Schema for LLM structured output
class TranslationOutput(BaseModel):
    python_code: str
    description: str
