"""Persist feedback vectors and private assistant conversations."""
import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "87cb247ac941"
down_revision = "3c1f2a9d7e41"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("feedback", sa.Column("search_embedding", Vector(384), nullable=True))
    op.add_column("feedback", sa.Column("search_embedding_key", sa.String(128), nullable=True))
    op.create_index(
        "ix_feedback_search_location_date",
        "feedback",
        ["location_id", "created_at"],
        postgresql_where=sa.text("search_embedding IS NOT NULL"),
    )
    # Even a direct SQL update cannot leave a vector for withdrawn or replaced text.
    op.execute("""
        CREATE FUNCTION echo_check_feedback_search_embedding() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.status <> 'approved' OR NEW.kind <> 'text'
               OR NEW.text_redacted IS NULL OR NEW.search_embedding IS NULL
               OR split_part(NEW.search_embedding_key, ':', 2) IS DISTINCT FROM
                  encode(sha256(convert_to(NEW.text_redacted, 'UTF8')), 'hex')
            THEN
                NEW.search_embedding := NULL;
                NEW.search_embedding_key := NULL;
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER echo_feedback_search_embedding
        BEFORE INSERT OR UPDATE OF status, kind, text_redacted, search_embedding, search_embedding_key
        ON feedback FOR EACH ROW EXECUTE FUNCTION echo_check_feedback_search_embedding()
    """)

    op.create_table(
        "assistant_conversations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(96), nullable=False),
        sa.Column("turn_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_assistant_owner_updated", "assistant_conversations", ["owner_id", "updated_at"])
    op.create_table(
        "assistant_messages",
        sa.Column("conversation_id", sa.String(), sa.ForeignKey("assistant_conversations.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("turn", sa.Integer(), primary_key=True),
        sa.Column("role", sa.String(9), primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.UniqueConstraint("conversation_id", "request_id", name="uq_assistant_message_request"),
    )


def downgrade():
    op.drop_table("assistant_messages")
    op.drop_index("ix_assistant_owner_updated", table_name="assistant_conversations")
    op.drop_table("assistant_conversations")
    op.execute("DROP TRIGGER echo_feedback_search_embedding ON feedback")
    op.execute("DROP FUNCTION echo_check_feedback_search_embedding()")
    op.drop_index("ix_feedback_search_location_date", table_name="feedback")
    op.drop_column("feedback", "search_embedding_key")
    op.drop_column("feedback", "search_embedding")
    # The extension can be shared by other applications or tables.
