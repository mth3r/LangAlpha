"""Database layer for user strategies."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from psycopg.rows import dict_row

from src.server.database.conversation import get_db_connection

logger = logging.getLogger(__name__)


async def list_strategies(user_id: str) -> List[Dict[str, Any]]:
    async with get_db_connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT strategy_id::text, user_id, name, pine_script,
                       python_code, description, created_at, updated_at
                FROM user_strategies
                WHERE user_id = %s
                ORDER BY created_at DESC
                """,
                (user_id,),
            )
            return await cur.fetchall()


async def get_strategy(strategy_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    async with get_db_connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT strategy_id::text, user_id, name, pine_script,
                       python_code, description, created_at, updated_at
                FROM user_strategies
                WHERE strategy_id = %s AND user_id = %s
                """,
                (strategy_id, user_id),
            )
            return await cur.fetchone()


async def create_strategy(
    user_id: str,
    name: str,
    pine_script: str,
    python_code: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    async with get_db_connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                INSERT INTO user_strategies (user_id, name, pine_script, python_code, description)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING strategy_id::text, user_id, name, pine_script,
                          python_code, description, created_at, updated_at
                """,
                (user_id, name, pine_script, python_code, description),
            )
            return await cur.fetchone()


async def update_strategy(
    strategy_id: str,
    user_id: str,
    name: Optional[str] = None,
    pine_script: Optional[str] = None,
    python_code: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    fields = []
    values = []
    if name is not None:
        fields.append("name = %s")
        values.append(name)
    if pine_script is not None:
        fields.append("pine_script = %s")
        values.append(pine_script)
    if python_code is not None:
        fields.append("python_code = %s")
        values.append(python_code)
    if description is not None:
        fields.append("description = %s")
        values.append(description)

    if not fields:
        return await get_strategy(strategy_id, user_id)

    fields.append("updated_at = NOW()")
    values.extend([strategy_id, user_id])

    async with get_db_connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                f"""
                UPDATE user_strategies
                SET {', '.join(fields)}
                WHERE strategy_id = %s AND user_id = %s
                RETURNING strategy_id::text, user_id, name, pine_script,
                          python_code, description, created_at, updated_at
                """,
                values,
            )
            return await cur.fetchone()


async def delete_strategy(strategy_id: str, user_id: str) -> bool:
    async with get_db_connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM user_strategies WHERE strategy_id = %s AND user_id = %s",
                (strategy_id, user_id),
            )
            return cur.rowcount > 0
