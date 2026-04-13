"""
Portfolio API Router.

Provides REST endpoints for portfolio management.

Endpoints:
- GET /api/v1/users/me/portfolio - List all holdings
- POST /api/v1/users/me/portfolio - Add holding
- GET /api/v1/users/me/portfolio/template - Download CSV import template
- POST /api/v1/users/me/portfolio/import - Bulk import from CSV
- GET /api/v1/users/me/portfolio/{holding_id} - Get single holding
- PUT /api/v1/users/me/portfolio/{holding_id} - Update holding
- DELETE /api/v1/users/me/portfolio/{holding_id} - Remove holding
"""

import asyncio
import csv
import io
import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import List

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from src.server.database.portfolio import (
    delete_portfolio_holding as db_delete_portfolio_holding,
    get_portfolio_holding as db_get_portfolio_holding,
    get_user_portfolio as db_get_user_portfolio,
    update_portfolio_holding as db_update_portfolio_holding,
    upsert_portfolio_holding as db_upsert_portfolio_holding,
)
from src.server.services.onboarding import maybe_complete_onboarding
from src.server.models.user import (
    PortfolioHoldingCreate,
    PortfolioHoldingResponse,
    PortfolioHoldingUpdate,
    PortfolioResponse,
)
from src.server.utils.api import CurrentUserId, handle_api_exceptions, raise_not_found

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/users/me/portfolio", tags=["Portfolio"])


_CSV_TEMPLATE_HEADERS = [
    "symbol", "shares", "purchase_price", "purchase_date",
    "account", "notes",
]
_CSV_TEMPLATE_EXAMPLE = [
    "AAPL", "10", "150.00", "2022-01-15", "Robinhood", "Optional notes",
    "NVDA", "5", "220.00", "2023-06-01", "Fidelity", "",
    "MSFT", "8", "310.50", "2021-11-10", "", "",
]

# ── Pydantic models for import ─────────────────────────────────────────────

class ImportRow(BaseModel):
    symbol: str
    shares: float
    purchase_price: float
    purchase_date: str        # YYYY-MM-DD
    account: str = ""
    notes: str = ""
    # Populated by server after split adjustment:
    adjusted_shares: float = 0.0
    adjusted_price: float = 0.0
    split_ratio: float = 1.0
    error: str = ""

class ImportPreviewResponse(BaseModel):
    rows: List[ImportRow]
    total: int
    errors: int

class ImportConfirmResponse(BaseModel):
    imported: int
    skipped: int
    errors: List[str]


# ── Helpers ────────────────────────────────────────────────────────────────

async def _get_split_ratio(symbol: str, from_date: str) -> float:
    """Return cumulative split multiplier for shares since from_date (e.g. 2.0 for a 2:1 split)."""
    try:
        import yfinance as yf
        from datetime import timedelta

        def _fetch():
            t = yf.Ticker(symbol)
            splits = t.splits  # pd.Series indexed by date
            if splits is None or splits.empty:
                return 1.0
            cutoff = datetime.fromisoformat(from_date).date()
            ratio = 1.0
            for dt, factor in splits.items():
                split_date = dt.date() if hasattr(dt, "date") else dt
                if split_date >= cutoff:
                    ratio *= float(factor)
            return ratio

        return await asyncio.to_thread(_fetch)
    except Exception:
        return 1.0


def _parse_csv(content: bytes) -> tuple[list[ImportRow], list[str]]:
    """Parse CSV bytes into ImportRow list. Returns (rows, parse_errors)."""
    rows: list[ImportRow] = []
    errors: list[str] = []
    text = content.decode("utf-8-sig").strip()  # strip BOM if present
    reader = csv.DictReader(io.StringIO(text))

    # Normalize header names
    if reader.fieldnames is None:
        return rows, ["CSV has no headers"]
    headers = [h.strip().lower().replace(" ", "_") for h in reader.fieldnames]
    reader.fieldnames = headers

    required = {"symbol", "shares", "purchase_price", "purchase_date"}
    missing = required - set(headers)
    if missing:
        return rows, [f"Missing required columns: {', '.join(sorted(missing))}"]

    for i, raw in enumerate(reader, start=2):  # row 2 is first data row
        sym = (raw.get("symbol") or "").strip().upper()
        if not sym:
            continue  # skip blank rows

        try:
            shares = float((raw.get("shares") or "").replace(",", ""))
            price = float((raw.get("purchase_price") or "").replace(",", "").replace("$", ""))
            date_str = (raw.get("purchase_date") or "").strip()
            # Accept MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%-m/%-d/%Y"):
                try:
                    parsed_date = datetime.strptime(date_str, fmt)
                    date_str = parsed_date.strftime("%Y-%m-%d")
                    break
                except ValueError:
                    continue
            else:
                raise ValueError(f"Unrecognised date '{date_str}' (use YYYY-MM-DD)")

            rows.append(ImportRow(
                symbol=sym,
                shares=shares,
                purchase_price=price,
                purchase_date=date_str,
                account=(raw.get("account") or "").strip(),
                notes=(raw.get("notes") or "").strip(),
            ))
        except (ValueError, KeyError) as e:
            errors.append(f"Row {i} ({sym or '?'}): {e}")

    return rows, errors


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/template")
async def download_template():
    """Download a CSV template for bulk portfolio import."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_CSV_TEMPLATE_HEADERS)
    for i in range(0, len(_CSV_TEMPLATE_EXAMPLE), len(_CSV_TEMPLATE_HEADERS)):
        w.writerow(_CSV_TEMPLATE_EXAMPLE[i:i + len(_CSV_TEMPLATE_HEADERS)])
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="portfolio_import_template.csv"'},
    )


@router.post("/preview", response_model=ImportPreviewResponse)
@handle_api_exceptions("preview portfolio import", logger)
async def preview_portfolio_import(
    file: UploadFile = File(...),
    user_id: CurrentUserId = ...,
):
    """Parse a CSV and return split-adjusted rows for user review before importing."""
    content = await file.read()
    rows, parse_errors = _parse_csv(content)

    if parse_errors and not rows:
        raise HTTPException(status_code=422, detail="; ".join(parse_errors))

    # Fetch split ratios in parallel
    async def _adjust(row: ImportRow) -> ImportRow:
        ratio = await _get_split_ratio(row.symbol, row.purchase_date)
        row.adjusted_shares = round(row.shares * ratio, 6)
        row.adjusted_price = round(row.purchase_price / ratio, 6) if ratio else row.purchase_price
        row.split_ratio = ratio
        return row

    rows = await asyncio.gather(*[_adjust(r) for r in rows])

    # Attach any parse errors as error rows
    for msg in parse_errors:
        rows.append(ImportRow(symbol="", shares=0, purchase_price=0, purchase_date="", error=msg))

    return ImportPreviewResponse(
        rows=list(rows),
        total=len([r for r in rows if not r.error]),
        errors=len([r for r in rows if r.error]),
    )


@router.post("/import", response_model=ImportConfirmResponse, status_code=201)
@handle_api_exceptions("import portfolio", logger)
async def import_portfolio(
    file: UploadFile = File(...),
    user_id: CurrentUserId = ...,
):
    """Bulk import portfolio holdings from CSV with automatic split adjustment."""
    content = await file.read()
    rows, parse_errors = _parse_csv(content)

    imported = 0
    skipped = 0
    errors = list(parse_errors)

    async def _import_row(row: ImportRow):
        nonlocal imported, skipped
        try:
            ratio = await _get_split_ratio(row.symbol, row.purchase_date)
            adj_shares = Decimal(str(round(row.shares * ratio, 6)))
            adj_price = Decimal(str(round(row.purchase_price / ratio, 6))) if ratio else Decimal(str(row.purchase_price))

            purchase_dt = datetime.fromisoformat(row.purchase_date).replace(tzinfo=timezone.utc)

            await db_upsert_portfolio_holding(
                user_id=user_id,
                symbol=row.symbol,
                instrument_type="stock",
                quantity=adj_shares,
                average_cost=adj_price,
                currency="USD",
                account_name=row.account or None,
                notes=row.notes or None,
                first_purchased_at=purchase_dt,
            )
            imported += 1
        except Exception as e:
            errors.append(f"{row.symbol}: {e}")
            skipped += 1

    await asyncio.gather(*[_import_row(r) for r in rows])

    return ImportConfirmResponse(imported=imported, skipped=skipped, errors=errors)


@router.get("", response_model=PortfolioResponse)
@handle_api_exceptions("list portfolio", logger)
async def list_portfolio(user_id: CurrentUserId):
    """
    List all portfolio holdings for the current user.

    Args:
        user_id: User ID from authentication header

    Returns:
        List of portfolio holdings with total count
    """
    holdings = await db_get_user_portfolio(user_id)

    return PortfolioResponse(
        holdings=[PortfolioHoldingResponse.model_validate(h) for h in holdings],
        total=len(holdings),
    )


@router.post("", response_model=PortfolioHoldingResponse, status_code=201)
@handle_api_exceptions("add portfolio holding", logger)
async def add_portfolio_holding(
    request: PortfolioHoldingCreate,
    user_id: CurrentUserId,
    response: Response,
):
    """
    Add a holding to the portfolio. If the same symbol + instrument_type + account_name
    already exists, merges the position (sums quantity, computes weighted average cost).

    Args:
        request: Portfolio holding data
        user_id: User ID from authentication header
        response: FastAPI response for setting status code

    Returns:
        Created or merged portfolio holding (201 for new, 200 for merged)
    """
    holding, merge_details = await db_upsert_portfolio_holding(
        user_id=user_id,
        symbol=request.symbol,
        instrument_type=request.instrument_type.value,
        quantity=request.quantity,
        exchange=request.exchange,
        name=request.name,
        average_cost=request.average_cost,
        currency=request.currency,
        account_name=request.account_name,
        notes=request.notes,
        metadata=request.metadata,
        first_purchased_at=request.first_purchased_at,
    )

    await maybe_complete_onboarding(user_id)

    if merge_details:
        response.status_code = 200
        logger.info(f"Merged portfolio holding {holding['user_portfolio_id']} for user {user_id}")
    else:
        logger.info(f"Added portfolio holding {holding['user_portfolio_id']} for user {user_id}")

    return PortfolioHoldingResponse.model_validate(holding)


@router.get("/{holding_id}", response_model=PortfolioHoldingResponse)
@handle_api_exceptions("get portfolio holding", logger)
async def get_portfolio_holding(
    holding_id: str,
    user_id: CurrentUserId,
):
    """
    Get a single portfolio holding.

    Args:
        holding_id: Portfolio holding ID
        user_id: User ID from authentication header

    Returns:
        Portfolio holding details

    Raises:
        404: Holding not found or not owned by user
    """
    holding = await db_get_portfolio_holding(holding_id, user_id)

    if not holding:
        raise_not_found("Portfolio holding")

    return PortfolioHoldingResponse.model_validate(holding)


@router.put("/{holding_id}", response_model=PortfolioHoldingResponse)
@handle_api_exceptions("update portfolio holding", logger)
async def update_portfolio_holding(
    holding_id: str,
    request: PortfolioHoldingUpdate,
    user_id: CurrentUserId,
):
    """
    Update a portfolio holding.

    Partial update supported - only provided fields are updated.

    Args:
        holding_id: Portfolio holding ID
        request: Fields to update
        user_id: User ID from authentication header

    Returns:
        Updated portfolio holding

    Raises:
        404: Holding not found or not owned by user
    """
    holding = await db_update_portfolio_holding(
        user_portfolio_id=holding_id,
        user_id=user_id,
        name=request.name,
        quantity=request.quantity,
        average_cost=request.average_cost,
        currency=request.currency,
        account_name=request.account_name,
        notes=request.notes,
        metadata=request.metadata,
        first_purchased_at=request.first_purchased_at,
    )

    if not holding:
        raise_not_found("Portfolio holding")

    logger.info(f"Updated portfolio holding {holding_id} for user {user_id}")
    return PortfolioHoldingResponse.model_validate(holding)


@router.delete("/{holding_id}", status_code=204)
@handle_api_exceptions("delete portfolio holding", logger)
async def delete_portfolio_holding(
    holding_id: str,
    user_id: CurrentUserId,
):
    """
    Remove a holding from the portfolio.

    Args:
        holding_id: Portfolio holding ID
        user_id: User ID from authentication header

    Returns:
        204 No Content on success

    Raises:
        404: Holding not found or not owned by user
    """
    deleted = await db_delete_portfolio_holding(holding_id, user_id)

    if not deleted:
        raise_not_found("Portfolio holding")

    logger.info(f"Deleted portfolio holding {holding_id} for user {user_id}")
    return Response(status_code=204)
