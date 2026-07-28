use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use thiserror::Error;

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

pub(super) fn validate_redeemable_row(
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

pub(super) fn invite_from_row(
    row: sqlx::sqlite::SqliteRow,
) -> Result<CampaignInvite, InviteStoreError> {
    let role = match row.get::<String, _>("role").as_str() {
        "player" => InviteRole::Player,
        _ => return Err(InviteStoreError::InvalidIdentity),
    };
    let expires_at = row.get::<Option<i64>, _>("expires_at");
    let max_uses = row.get::<Option<i64>, _>("max_uses");
    let use_count = row.get::<i64, _>("use_count");
    let revoked_at = row.get::<Option<String>, _>("revoked_at");
    let status = invite_status(
        expires_at,
        max_uses,
        use_count,
        revoked_at.as_deref(),
        Utc::now().timestamp(),
    );
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

fn invite_status(
    expires_at: Option<i64>,
    max_uses: Option<i64>,
    use_count: i64,
    revoked_at: Option<&str>,
    now: i64,
) -> InviteStatus {
    if revoked_at.is_some() {
        InviteStatus::Revoked
    } else if expires_at.is_some_and(|expires_at| expires_at <= now) {
        InviteStatus::Expired
    } else if max_uses.is_some_and(|max_uses| use_count >= max_uses) {
        InviteStatus::Exhausted
    } else {
        InviteStatus::Active
    }
}

pub(super) fn clean_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn hash_token(raw_token: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};

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

    #[test]
    fn invite_status_applies_terminal_states_in_policy_order() {
        let now = 100;
        assert_eq!(
            invite_status(None, None, 0, None, now),
            InviteStatus::Active
        );
        assert_eq!(
            invite_status(Some(now), None, 0, None, now),
            InviteStatus::Expired
        );
        assert_eq!(
            invite_status(None, Some(2), 2, None, now),
            InviteStatus::Exhausted
        );
        assert_eq!(
            invite_status(Some(now), Some(1), 1, Some("revoked"), now),
            InviteStatus::Revoked
        );
    }
}
