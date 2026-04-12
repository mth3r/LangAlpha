"""
Strategies API Router.

Provides REST endpoints for Pine Script strategy management and backtesting.

Endpoints:
- GET /api/v1/strategies - List user's strategies
- POST /api/v1/strategies - Create strategy (triggers AI translation)
- PUT /api/v1/strategies/{strategy_id} - Update strategy (re-translates)
- DELETE /api/v1/strategies/{strategy_id} - Delete strategy
- POST /api/v1/strategies/{strategy_id}/run - Run backtest
"""

import logging

from fastapi import APIRouter, HTTPException

from src.server.database.strategy import (
    create_strategy as db_create_strategy,
    delete_strategy as db_delete_strategy,
    get_strategy as db_get_strategy,
    list_strategies as db_list_strategies,
    update_strategy as db_update_strategy,
)
from src.server.models.strategy import (
    RunStrategyRequest,
    RunStrategyResponse,
    SignalPoint,
    StrategiesListResponse,
    StrategyCreate,
    StrategyResponse,
    StrategyUpdate,
)
from src.server.services.strategy_service import (
    generate_commentary,
    run_strategy,
    translate_pine_to_python,
)
from src.server.utils.api import CurrentUserId, handle_api_exceptions, raise_not_found

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/strategies", tags=["Strategies"])


@router.get("", response_model=StrategiesListResponse)
@handle_api_exceptions("list strategies", logger)
async def list_strategies(user_id: CurrentUserId):
    strategies = await db_list_strategies(user_id)
    return StrategiesListResponse(
        strategies=[StrategyResponse.model_validate(s) for s in strategies],
        total=len(strategies),
    )


@router.post("", response_model=StrategyResponse, status_code=201)
@handle_api_exceptions("create strategy", logger)
async def create_strategy(body: StrategyCreate, user_id: CurrentUserId):
    # Translate Pine Script → Python via AI
    python_code, description = await translate_pine_to_python(body.pine_script)

    row = await db_create_strategy(
        user_id=user_id,
        name=body.name,
        pine_script=body.pine_script,
        python_code=python_code,
        description=description,
    )
    return StrategyResponse.model_validate(row)


@router.put("/{strategy_id}", response_model=StrategyResponse)
@handle_api_exceptions("update strategy", logger)
async def update_strategy(
    strategy_id: str, body: StrategyUpdate, user_id: CurrentUserId
):
    existing = await db_get_strategy(strategy_id, user_id)
    if not existing:
        raise_not_found("Strategy", strategy_id)

    python_code = None
    description = None
    if body.pine_script is not None:
        python_code, description = await translate_pine_to_python(body.pine_script)

    row = await db_update_strategy(
        strategy_id=strategy_id,
        user_id=user_id,
        name=body.name,
        pine_script=body.pine_script,
        python_code=python_code,
        description=description,
    )
    if not row:
        raise_not_found("Strategy", strategy_id)
    return StrategyResponse.model_validate(row)


@router.delete("/{strategy_id}", status_code=204)
@handle_api_exceptions("delete strategy", logger)
async def delete_strategy(strategy_id: str, user_id: CurrentUserId):
    deleted = await db_delete_strategy(strategy_id, user_id)
    if not deleted:
        raise_not_found("Strategy", strategy_id)


@router.post("/{strategy_id}/run", response_model=RunStrategyResponse)
@handle_api_exceptions("run strategy", logger)
async def run_strategy_endpoint(
    strategy_id: str, body: RunStrategyRequest, user_id: CurrentUserId
):
    strategy = await db_get_strategy(strategy_id, user_id)
    if not strategy:
        raise_not_found("Strategy", strategy_id)

    if not strategy.get("python_code"):
        raise HTTPException(
            status_code=422,
            detail="Strategy has not been translated yet. Save the strategy first.",
        )

    result = await run_strategy(
        python_code=strategy["python_code"],
        symbol=body.symbol,
        interval=body.interval,
        from_date=body.from_date,
        to_date=body.to_date,
    )

    signals = [SignalPoint.model_validate(s) for s in result["signals"]]
    stats = result["stats"]

    commentary = await generate_commentary(
        stats=stats,
        strategy_name=strategy["name"],
        symbol=body.symbol,
    )

    return RunStrategyResponse(
        strategy_id=strategy_id,
        symbol=body.symbol,
        interval=body.interval,
        signals=signals,
        stats=stats,
        ai_commentary=commentary or None,
    )
