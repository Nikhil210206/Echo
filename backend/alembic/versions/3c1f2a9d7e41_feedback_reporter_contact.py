"""feedback reporter contact

Revision ID: 3c1f2a9d7e41
Revises: 8bbb10748d56
Create Date: 2026-09-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c1f2a9d7e41'
down_revision: Union[str, Sequence[str], None] = '8bbb10748d56'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Optional name and phone a reporter can leave for follow-up."""
    op.add_column('feedback', sa.Column('reporter_name', sa.String(), nullable=True))
    op.add_column('feedback', sa.Column('reporter_phone', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('feedback', 'reporter_phone')
    op.drop_column('feedback', 'reporter_name')
