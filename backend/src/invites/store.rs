use sqlx::{Row, SqlitePool};

use super::model::{hash_token, invite_from_row};
use super::{CampaignInvite, CreateInviteInput, InviteStatus, InviteStoreError, PublicInvite};

#[derive(Debug, Clone)]
pub(crate) struct InviteStore {
    pub(super) pool: SqlitePool,
}

impl InviteStore {
    pub(crate) async fn initialize(pool: SqlitePool) -> Result<Self, InviteStoreError> {
        let store = Self { pool };
        let mut tx = store.pool.begin().await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS campaign_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL REFERENCES campaign_presets(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                token_hint TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role = 'player'),
                expires_at INTEGER,
                max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
                use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                revoked_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS campaign_invite_redemptions (
                invite_id INTEGER NOT NULL REFERENCES campaign_invites(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (invite_id, user_id)
            )
            "#,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS invite_restricted_users (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS campaign_invites_campaign_id_idx ON campaign_invites(campaign_id)",
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(store)
    }

    pub(crate) async fn create_invite(
        &self,
        campaign_id: i64,
        created_by_user_id: i64,
        input: &CreateInviteInput,
        raw_token: &str,
    ) -> Result<CampaignInvite, InviteStoreError> {
        let token_hash = hash_token(raw_token);
        let token_hint = raw_token.chars().take(8).collect::<String>();
        let result = sqlx::query(
            r#"
            INSERT INTO campaign_invites (
                campaign_id, token_hash, token_hint, role, expires_at,
                max_uses, created_by_user_id
            ) VALUES (?, ?, ?, 'player', ?, ?, ?)
            "#,
        )
        .bind(campaign_id)
        .bind(token_hash)
        .bind(token_hint)
        .bind(input.expires_at)
        .bind(input.max_uses)
        .bind(created_by_user_id)
        .execute(&self.pool)
        .await?;
        self.find_invite_by_id(result.last_insert_rowid())
            .await?
            .ok_or(InviteStoreError::InviteNotFound)
    }

    pub(crate) async fn list_invites(
        &self,
        campaign_id: i64,
    ) -> Result<Vec<CampaignInvite>, InviteStoreError> {
        let rows = sqlx::query(
            r#"
            SELECT campaign_invites.id, campaign_invites.campaign_id,
                   campaign_presets.display_name AS campaign_display_name,
                   campaign_presets.room_slug, campaign_invites.token_hint,
                   campaign_invites.role, campaign_invites.expires_at,
                   campaign_invites.max_uses, campaign_invites.use_count,
                   campaign_invites.revoked_at, campaign_invites.created_at
            FROM campaign_invites
            INNER JOIN campaign_presets ON campaign_presets.id = campaign_invites.campaign_id
            WHERE campaign_invites.campaign_id = ?
            ORDER BY campaign_invites.created_at DESC, campaign_invites.id DESC
            "#,
        )
        .bind(campaign_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(invite_from_row).collect()
    }

    pub(crate) async fn revoke_invite(
        &self,
        campaign_id: i64,
        invite_id: i64,
    ) -> Result<(), InviteStoreError> {
        let result = sqlx::query(
            r#"
            UPDATE campaign_invites
            SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
            WHERE id = ? AND campaign_id = ?
            "#,
        )
        .bind(invite_id)
        .bind(campaign_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(InviteStoreError::InviteNotFound);
        }
        Ok(())
    }

    pub(crate) async fn inspect_invite(
        &self,
        raw_token: &str,
    ) -> Result<PublicInvite, InviteStoreError> {
        let row = sqlx::query(
            r#"
            SELECT campaign_invites.id, campaign_invites.campaign_id,
                   campaign_presets.display_name AS campaign_display_name,
                   campaign_presets.room_slug, campaign_presets.is_archived,
                   campaign_invites.token_hint, campaign_invites.role,
                   campaign_invites.expires_at, campaign_invites.max_uses,
                   campaign_invites.use_count, campaign_invites.revoked_at,
                   campaign_invites.created_at
            FROM campaign_invites
            INNER JOIN campaign_presets ON campaign_presets.id = campaign_invites.campaign_id
            WHERE campaign_invites.token_hash = ?
            "#,
        )
        .bind(hash_token(raw_token))
        .fetch_optional(&self.pool)
        .await?
        .ok_or(InviteStoreError::InviteNotFound)?;
        let is_archived = row.get::<i64, _>("is_archived") != 0;
        let invite = invite_from_row(row)?;
        let status = if is_archived {
            InviteStatus::Archived
        } else {
            invite.status
        };
        Ok(PublicInvite {
            campaign_id: invite.campaign_id,
            campaign_display_name: invite.campaign_display_name,
            room_slug: invite.room_slug,
            role: invite.role,
            expires_at: invite.expires_at,
            status,
        })
    }

    pub(crate) async fn is_user_invite_restricted(
        &self,
        user_id: i64,
    ) -> Result<bool, InviteStoreError> {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM invite_restricted_users WHERE user_id = ?",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    async fn find_invite_by_id(
        &self,
        invite_id: i64,
    ) -> Result<Option<CampaignInvite>, InviteStoreError> {
        let row = sqlx::query(
            r#"
            SELECT campaign_invites.id, campaign_invites.campaign_id,
                   campaign_presets.display_name AS campaign_display_name,
                   campaign_presets.room_slug, campaign_invites.token_hint,
                   campaign_invites.role, campaign_invites.expires_at,
                   campaign_invites.max_uses, campaign_invites.use_count,
                   campaign_invites.revoked_at, campaign_invites.created_at
            FROM campaign_invites
            INNER JOIN campaign_presets ON campaign_presets.id = campaign_invites.campaign_id
            WHERE campaign_invites.id = ?
            "#,
        )
        .bind(invite_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(invite_from_row).transpose()
    }
}
