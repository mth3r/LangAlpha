"""Add user_strategies table for Pine Script strategy tester.

Revision ID: 008
Revises: 007
Create Date: 2026-04-12
"""

from typing import Sequence, Union

from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_strategies (
            strategy_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         VARCHAR(255) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            pine_script     TEXT NOT NULL,
            python_code     TEXT,
            description     TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS user_strategies_user_id_idx
        ON user_strategies (user_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_strategies")
