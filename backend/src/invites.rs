use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use thiserror::Error;
use tracing::error;

use crate::{
    auth::{random_token, require_authenticated},
    error::ApiError,
    state::AppState,
    users::{AuthUser, GameRole, PlatformRole},
};

const MAX_INVITE_USES: i64 = 1_000;
const INVITE_TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone)]
pub(crate) struct InviteStore {
    pool: SqlitePool,
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

    pub(crate) async fn redeem_invite(
        &self,
        raw_token: &str,
        email: &str,
        google_subject: &str,
        display_name: Option<&str>,
    ) -> Result<RedeemedInvite, InviteStoreError> {
        let normalized_email = email.trim().to_lowercase();
        if normalized_email.is_empty() || google_subject.trim().is_empty() {
            return Err(InviteStoreError::InvalidIdentity);
        }
        let now = Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            r#"
            SELECT campaign_invites.id, campaign_invites.campaign_id,
                   campaign_presets.display_name AS campaign_display_name,
                   campaign_presets.room_slug, campaign_presets.is_archived,
                   campaign_invites.expires_at, campaign_invites.max_uses,
                   campaign_invites.use_count, campaign_invites.revoked_at
            FROM campaign_invites
            INNER JOIN campaign_presets ON campaign_presets.id = campaign_invites.campaign_id
            WHERE campaign_invites.token_hash = ?
            "#,
        )
        .bind(hash_token(raw_token))
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(InviteStoreError::InviteNotFound)?;
        let invite_id = row.get::<i64, _>("id");
        let campaign_id = row.get::<i64, _>("campaign_id");
        let campaign_display_name = row.get::<String, _>("campaign_display_name");
        let room_slug = row.get::<String, _>("room_slug");

        let existing = sqlx::query(
            "SELECT id, google_subject, platform_role, game_role, is_active FROM users WHERE normalized_email = ?",
        )
        .bind(&normalized_email)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = existing.as_ref() {
            let is_privileged = existing.get::<String, _>("platform_role") == "admin"
                || existing.get::<String, _>("game_role") == "gamemaster";
            if existing.get::<i64, _>("is_active") == 0 && is_privileged {
                return Err(InviteStoreError::PrivilegedIdentity);
            }
            let existing_subject = existing.get::<Option<String>, _>("google_subject");
            if existing_subject
                .as_deref()
                .is_some_and(|subject| subject != google_subject)
            {
                return Err(InviteStoreError::IdentityMismatch);
            }
            let user_id = existing.get::<i64, _>("id");
            let already_redeemed = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM campaign_invite_redemptions WHERE invite_id = ? AND user_id = ?",
            )
            .bind(invite_id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?
                > 0;
            if already_redeemed {
                tx.commit().await?;
                return Ok(RedeemedInvite {
                    user_id,
                    campaign_id,
                    campaign_display_name,
                    room_slug,
                });
            }
        }

        validate_redeemable_row(&row, now)?;

        let (user_id, created_user) = if let Some(existing) = existing {
            let user_id = existing.get::<i64, _>("id");
            sqlx::query(
                r#"
                UPDATE users
                SET email = ?, display_name = COALESCE(?, display_name),
                    google_subject = COALESCE(google_subject, ?), is_active = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(email.trim())
            .bind(clean_optional_text(display_name))
            .bind(google_subject)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
            (user_id, false)
        } else {
            let result = sqlx::query(
                r#"
                INSERT INTO users (
                    email, normalized_email, display_name, google_subject,
                    platform_role, game_role, is_active
                ) VALUES (?, ?, ?, ?, 'user', 'player', 1)
                "#,
            )
            .bind(email.trim())
            .bind(&normalized_email)
            .bind(clean_optional_text(display_name))
            .bind(google_subject)
            .execute(&mut *tx)
            .await?;
            (result.last_insert_rowid(), true)
        };

        let consumed = sqlx::query(
            r#"
            UPDATE campaign_invites
            SET use_count = use_count + 1
            WHERE id = ? AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > ?)
              AND (max_uses IS NULL OR use_count < max_uses)
            "#,
        )
        .bind(invite_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        if consumed.rows_affected() != 1 {
            return Err(InviteStoreError::Exhausted);
        }
        sqlx::query("INSERT INTO campaign_invite_redemptions (invite_id, user_id) VALUES (?, ?)")
            .bind(invite_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"
            INSERT INTO campaign_members (campaign_id, user_id, game_role)
            VALUES (?, ?, 'player')
            ON CONFLICT(campaign_id, user_id) DO NOTHING
            "#,
        )
        .bind(campaign_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        if created_user {
            sqlx::query("INSERT INTO invite_restricted_users (user_id) VALUES (?)")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(RedeemedInvite {
            user_id,
            campaign_id,
            campaign_display_name,
            room_slug,
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

#[derive(Debug, Clone)]
pub(crate) struct CreateInviteInput {
    pub(crate) expires_at: Option<i64>,
    pub(crate) max_uses: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum InviteRole {
    Player,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum InviteStatus {
    Active,
    Revoked,
    Expired,
    Exhausted,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CampaignInvite {
    pub(crate) id: i64,
    pub(crate) campaign_id: i64,
    pub(crate) campaign_display_name: String,
    pub(crate) room_slug: String,
    pub(crate) token_hint: String,
    pub(crate) role: InviteRole,
    pub(crate) expires_at: Option<i64>,
    pub(crate) max_uses: Option<i64>,
    pub(crate) use_count: i64,
    pub(crate) status: InviteStatus,
    pub(crate) revoked_at: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PublicInvite {
    pub(crate) campaign_id: i64,
    pub(crate) campaign_display_name: String,
    pub(crate) room_slug: String,
    pub(crate) role: InviteRole,
    pub(crate) expires_at: Option<i64>,
    pub(crate) status: InviteStatus,
}

#[derive(Debug, Clone)]
pub(crate) struct RedeemedInvite {
    pub(crate) user_id: i64,
    pub(crate) campaign_id: i64,
    pub(crate) campaign_display_name: String,
    pub(crate) room_slug: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateInviteRequest {
    role: InviteRole,
    expires_at: Option<i64>,
    max_uses: Option<i64>,
}

impl CreateInviteRequest {
    fn validate(&self) -> Result<CreateInviteInput, ApiError> {
        if self.role != InviteRole::Player {
            return Err(ApiError::BadRequest(
                "invites may only grant player access".to_string(),
            ));
        }
        if self
            .expires_at
            .is_some_and(|value| value <= Utc::now().timestamp())
        {
            return Err(ApiError::BadRequest(
                "invite expiry must be in the future".to_string(),
            ));
        }
        if self
            .max_uses
            .is_some_and(|value| !(1..=MAX_INVITE_USES).contains(&value))
        {
            return Err(ApiError::BadRequest(format!(
                "invite max uses must be between 1 and {MAX_INVITE_USES}"
            )));
        }
        Ok(CreateInviteInput {
            expires_at: self.expires_at,
            max_uses: self.max_uses,
        })
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct CampaignInvitesResponse {
    invites: Vec<CampaignInvite>,
}

#[derive(Debug, Serialize)]
pub(crate) struct CreatedInviteResponse {
    invite: CampaignInvite,
    token: String,
    path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct RedeemedInviteResponse {
    campaign_id: i64,
    campaign_display_name: String,
    room_slug: String,
}

pub(crate) async fn list_campaign_invites(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(campaign_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    require_invite_manager(&state, &jar, campaign_id).await?;
    let invites = state
        .invite_store
        .list_invites(campaign_id)
        .await
        .map_err(invite_to_api_error)?;
    Ok(Json(CampaignInvitesResponse { invites }))
}

pub(crate) async fn create_campaign_invite(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(campaign_id): Path<i64>,
    Json(request): Json<CreateInviteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let manager = require_invite_manager(&state, &jar, campaign_id).await?;
    let campaign = state
        .user_store
        .find_campaign_by_id(campaign_id)
        .await
        .map_err(|err| {
            error!("campaign lookup for invite failed: {err}");
            ApiError::Internal
        })?
        .ok_or_else(|| ApiError::NotFound("campaign not found".to_string()))?;
    if campaign.is_archived {
        return Err(ApiError::Conflict(
            "archived campaigns cannot issue invites".to_string(),
        ));
    }
    let input = request.validate()?;
    let token = random_token(INVITE_TOKEN_BYTES)?;
    let invite = state
        .invite_store
        .create_invite(campaign_id, manager.id, &input, &token)
        .await
        .map_err(invite_to_api_error)?;
    Ok((
        StatusCode::CREATED,
        Json(CreatedInviteResponse {
            path: format!("/invite/{token}"),
            invite,
            token,
        }),
    ))
}

pub(crate) async fn revoke_campaign_invite(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path((campaign_id, invite_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, ApiError> {
    require_invite_manager(&state, &jar, campaign_id).await?;
    state
        .invite_store
        .revoke_invite(campaign_id, invite_id)
        .await
        .map_err(invite_to_api_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn inspect_campaign_invite(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let invite = state
        .invite_store
        .inspect_invite(&token)
        .await
        .map_err(invite_to_api_error)?;
    Ok(Json(invite))
}

pub(crate) async fn redeem_campaign_invite(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(token): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated(&state, &jar).await?;
    let subject = user.google_subject.as_deref().ok_or_else(|| {
        ApiError::Forbidden("authenticated user is missing Google identity".to_string())
    })?;
    let redeemed = state
        .invite_store
        .redeem_invite(&token, &user.email, subject, user.display_name.as_deref())
        .await
        .map_err(invite_to_api_error)?;
    Ok(Json(redeemed_response(redeemed)))
}

async fn require_invite_manager(
    state: &AppState,
    jar: &CookieJar,
    campaign_id: i64,
) -> Result<AuthUser, ApiError> {
    let manager = require_authenticated(state, jar).await?;
    if manager.platform_role != PlatformRole::Admin && manager.game_role != GameRole::Gamemaster {
        return Err(ApiError::Forbidden(
            "gamemaster or admin access is required".to_string(),
        ));
    }
    let allowed = state
        .user_store
        .user_can_manage_campaign(
            campaign_id,
            manager.id,
            manager.platform_role == PlatformRole::Admin,
        )
        .await
        .map_err(|err| {
            error!("invite ownership check failed: {err}");
            ApiError::Internal
        })?;
    if !allowed {
        return Err(ApiError::Forbidden(
            "you do not manage this campaign".to_string(),
        ));
    }
    Ok(manager)
}

pub(crate) fn invite_token_from_next(next: &str) -> Option<&str> {
    let path = next.split('?').next()?;
    let token = path.strip_prefix("/invite/")?;
    if token.is_empty() || token.contains('/') {
        None
    } else {
        Some(token)
    }
}

pub(crate) fn invite_error_code(error: &InviteStoreError) -> &'static str {
    match error {
        InviteStoreError::InviteNotFound => "invalid",
        InviteStoreError::Revoked => "revoked",
        InviteStoreError::Expired => "expired",
        InviteStoreError::Exhausted => "exhausted",
        InviteStoreError::CampaignArchived => "archived",
        InviteStoreError::IdentityMismatch | InviteStoreError::InvalidIdentity => "identity",
        InviteStoreError::PrivilegedIdentity => "privileged",
        InviteStoreError::Sqlx(_) => "internal",
    }
}

pub(crate) fn invite_to_api_error(error: InviteStoreError) -> ApiError {
    match error {
        InviteStoreError::InviteNotFound => {
            ApiError::NotFound("invite link is invalid".to_string())
        }
        InviteStoreError::Revoked => ApiError::Gone("invite link has been revoked".to_string()),
        InviteStoreError::Expired => ApiError::Gone("invite link has expired".to_string()),
        InviteStoreError::Exhausted => {
            ApiError::Gone("invite link has reached its maximum uses".to_string())
        }
        InviteStoreError::CampaignArchived => {
            ApiError::Gone("this campaign is archived".to_string())
        }
        InviteStoreError::IdentityMismatch => {
            ApiError::Forbidden("invite email is linked to another identity".to_string())
        }
        InviteStoreError::InvalidIdentity => {
            ApiError::BadRequest("invite identity is invalid".to_string())
        }
        InviteStoreError::PrivilegedIdentity => ApiError::Forbidden(
            "an invite cannot reactivate an administrator or gamemaster".to_string(),
        ),
        InviteStoreError::Sqlx(error) => {
            error!("invite store error: {error}");
            ApiError::Internal
        }
    }
}

fn redeemed_response(redeemed: RedeemedInvite) -> RedeemedInviteResponse {
    RedeemedInviteResponse {
        campaign_id: redeemed.campaign_id,
        campaign_display_name: redeemed.campaign_display_name,
        room_slug: redeemed.room_slug,
    }
}

fn validate_redeemable_row(
    row: &sqlx::sqlite::SqliteRow,
    now: i64,
) -> Result<(), InviteStoreError> {
    if row.get::<i64, _>("is_archived") != 0 {
        return Err(InviteStoreError::CampaignArchived);
    }
    if row.get::<Option<String>, _>("revoked_at").is_some() {
        return Err(InviteStoreError::Revoked);
    }
    if row
        .get::<Option<i64>, _>("expires_at")
        .is_some_and(|expires_at| expires_at <= now)
    {
        return Err(InviteStoreError::Expired);
    }
    let max_uses = row.get::<Option<i64>, _>("max_uses");
    let use_count = row.get::<i64, _>("use_count");
    if max_uses.is_some_and(|max_uses| use_count >= max_uses) {
        return Err(InviteStoreError::Exhausted);
    }
    Ok(())
}

fn invite_from_row(row: sqlx::sqlite::SqliteRow) -> Result<CampaignInvite, InviteStoreError> {
    let role = match row.get::<String, _>("role").as_str() {
        "player" => InviteRole::Player,
        _ => return Err(InviteStoreError::InvalidIdentity),
    };
    let expires_at = row.get::<Option<i64>, _>("expires_at");
    let max_uses = row.get::<Option<i64>, _>("max_uses");
    let use_count = row.get::<i64, _>("use_count");
    let revoked_at = row.get::<Option<String>, _>("revoked_at");
    let status = if revoked_at.is_some() {
        InviteStatus::Revoked
    } else if expires_at.is_some_and(|expires_at| expires_at <= Utc::now().timestamp()) {
        InviteStatus::Expired
    } else if max_uses.is_some_and(|max_uses| use_count >= max_uses) {
        InviteStatus::Exhausted
    } else {
        InviteStatus::Active
    };
    Ok(CampaignInvite {
        id: row.get("id"),
        campaign_id: row.get("campaign_id"),
        campaign_display_name: row.get("campaign_display_name"),
        room_slug: row.get("room_slug"),
        token_hint: row.get("token_hint"),
        role,
        expires_at,
        max_uses,
        use_count,
        status,
        revoked_at,
        created_at: row.get("created_at"),
    })
}

fn clean_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn hash_token(raw_token: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(raw_token.as_bytes()))
}

#[derive(Debug, Error)]
pub(crate) enum InviteStoreError {
    #[error("invite link is invalid")]
    InviteNotFound,
    #[error("invite link has been revoked")]
    Revoked,
    #[error("invite link has expired")]
    Expired,
    #[error("invite link has reached its maximum uses")]
    Exhausted,
    #[error("campaign is archived")]
    CampaignArchived,
    #[error("identity is already linked to another account")]
    IdentityMismatch,
    #[error("identity is invalid")]
    InvalidIdentity,
    #[error("invite cannot reactivate a privileged identity")]
    PrivilegedIdentity,
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::users::{build_bootstrap_users, CampaignInput, UserPatch, UserStore};

    async fn stores() -> (UserStore, InviteStore, i64, i64) {
        let users = UserStore::connect("sqlite::memory:").await.unwrap();
        let invite_store = InviteStore::initialize(users.sqlite_pool()).await.unwrap();
        let bootstrap = build_bootstrap_users(
            &[],
            &["gm@example.com".to_string()],
            &["player@example.com".to_string()],
        )
        .unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let player = users
            .find_user_by_email("player@example.com")
            .await
            .unwrap()
            .unwrap();
        let campaign = users
            .create_campaign(
                gm.id,
                CampaignInput {
                    display_name: "Thursday Night".to_string(),
                    room_slug: "thursday-night".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        (users, invite_store, campaign.id, player.id)
    }

    #[tokio::test]
    async fn redemption_creates_restricted_player_and_is_idempotent() {
        let (users, invites, campaign_id, _) = stores().await;
        invites
            .create_invite(
                campaign_id,
                1,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: Some(1),
                },
                "secret-token",
            )
            .await
            .unwrap();

        let first = invites
            .redeem_invite(
                "secret-token",
                "guest@example.com",
                "google-guest",
                Some("Guest"),
            )
            .await
            .unwrap();
        let second = invites
            .redeem_invite(
                "secret-token",
                "guest@example.com",
                "google-guest",
                Some("Guest"),
            )
            .await
            .unwrap();

        assert_eq!(first.user_id, second.user_id);
        let user = users
            .find_user_by_email("guest@example.com")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(user.platform_role, PlatformRole::User);
        assert_eq!(user.game_role, GameRole::Player);
        assert_eq!(
            users
                .campaign_role_for_user(campaign_id, user.id)
                .await
                .unwrap(),
            Some(GameRole::Player)
        );
        assert!(invites.is_user_invite_restricted(user.id).await.unwrap());
        assert_eq!(
            invites.list_invites(campaign_id).await.unwrap()[0].use_count,
            1
        );
    }

    #[tokio::test]
    async fn max_use_expiry_and_revocation_are_enforced() {
        let (_users, invites, campaign_id, _) = stores().await;
        let input = CreateInviteInput {
            expires_at: None,
            max_uses: Some(1),
        };
        let invite = invites
            .create_invite(campaign_id, 1, &input, "single-use")
            .await
            .unwrap();
        invites
            .redeem_invite("single-use", "one@example.com", "subject-one", None)
            .await
            .unwrap();
        assert!(matches!(
            invites
                .redeem_invite("single-use", "two@example.com", "subject-two", None)
                .await,
            Err(InviteStoreError::Exhausted)
        ));

        let revoked = invites
            .create_invite(campaign_id, 1, &input, "revoked")
            .await
            .unwrap();
        invites
            .revoke_invite(campaign_id, revoked.id)
            .await
            .unwrap();
        assert!(matches!(
            invites
                .redeem_invite("revoked", "three@example.com", "subject-three", None)
                .await,
            Err(InviteStoreError::Revoked)
        ));

        invites
            .create_invite(
                campaign_id,
                1,
                &CreateInviteInput {
                    expires_at: Some(Utc::now().timestamp() - 1),
                    max_uses: None,
                },
                "expired",
            )
            .await
            .unwrap();
        assert!(matches!(
            invites
                .redeem_invite("expired", "four@example.com", "subject-four", None)
                .await,
            Err(InviteStoreError::Expired)
        ));
        assert_eq!(invite.status, InviteStatus::Active);
    }

    #[tokio::test]
    async fn redemption_never_promotes_existing_player() {
        let (users, invites, campaign_id, player_id) = stores().await;
        invites
            .create_invite(
                campaign_id,
                1,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: None,
                },
                "player-only",
            )
            .await
            .unwrap();
        invites
            .redeem_invite(
                "player-only",
                "player@example.com",
                "google-player",
                Some("Player"),
            )
            .await
            .unwrap();
        let user = users.find_user_by_id(player_id).await.unwrap().unwrap();
        assert_eq!(user.platform_role, PlatformRole::User);
        assert_eq!(user.game_role, GameRole::Player);
        assert_eq!(
            users
                .campaign_role_for_user(campaign_id, player_id)
                .await
                .unwrap(),
            Some(GameRole::Player)
        );
    }

    #[tokio::test]
    async fn invite_cannot_reactivate_a_privileged_user() {
        let (users, invites, campaign_id, _) = stores().await;
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        users
            .update_user(
                gm.id,
                UserPatch {
                    is_active: Some(false),
                    ..UserPatch::default()
                },
            )
            .await
            .unwrap();
        invites
            .create_invite(
                campaign_id,
                gm.id,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: None,
                },
                "no-privilege-reactivation",
            )
            .await
            .unwrap();

        assert!(matches!(
            invites
                .redeem_invite(
                    "no-privilege-reactivation",
                    "gm@example.com",
                    "google-gm",
                    Some("GM"),
                )
                .await,
            Err(InviteStoreError::PrivilegedIdentity)
        ));
    }

    #[tokio::test]
    async fn invites_survive_database_reconnect_without_persisting_the_raw_token() {
        let path = std::env::temp_dir().join(format!(
            "virtual-table-invite-{}-{}.sqlite",
            std::process::id(),
            Utc::now().timestamp_micros()
        ));
        std::fs::File::create(&path).unwrap();
        let database_url = format!("sqlite://{}", path.display());
        let users = UserStore::connect(&database_url).await.unwrap();
        let invites = InviteStore::initialize(users.sqlite_pool()).await.unwrap();
        let bootstrap = build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let campaign = users
            .create_campaign(
                gm.id,
                CampaignInput {
                    display_name: "Persistent Invite Table".to_string(),
                    room_slug: "persistent-invite-table".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        invites
            .create_invite(
                campaign.id,
                gm.id,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: Some(3),
                },
                "raw-token-is-not-stored",
            )
            .await
            .unwrap();
        users.sqlite_pool().close().await;

        let reopened_users = UserStore::connect(&database_url).await.unwrap();
        let reopened_pool = reopened_users.sqlite_pool();
        let reopened_invites = InviteStore::initialize(reopened_pool.clone())
            .await
            .unwrap();
        let persisted = reopened_invites.list_invites(campaign.id).await.unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].token_hint, "raw-toke");
        assert_eq!(persisted[0].max_uses, Some(3));
        assert_eq!(
            reopened_invites
                .inspect_invite("raw-token-is-not-stored")
                .await
                .unwrap()
                .status,
            InviteStatus::Active
        );
        let raw_token_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM campaign_invites WHERE token_hash = ?",
        )
        .bind("raw-token-is-not-stored")
        .fetch_one(&reopened_pool)
        .await
        .unwrap();
        assert_eq!(raw_token_count, 0);

        reopened_pool.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
