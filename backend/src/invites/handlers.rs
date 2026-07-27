use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::error;

use super::{CampaignInvite, CreateInviteInput, InviteRole, InviteStoreError, RedeemedInvite};
use crate::{
    auth::{random_token, require_authenticated},
    error::ApiError,
    state::AppState,
    users::{AuthUser, GameRole, PlatformRole},
};

const MAX_INVITE_USES: i64 = 1_000;
const INVITE_TOKEN_BYTES: usize = 32;

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
struct CampaignInvitesResponse {
    invites: Vec<CampaignInvite>,
}

#[derive(Debug, Serialize)]
struct CreatedInviteResponse {
    invite: CampaignInvite,
    token: String,
    path: String,
}

#[derive(Debug, Serialize)]
struct RedeemedInviteResponse {
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
        .campaign_store
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
        .campaign_store
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_invite_request_rejects_excessive_max_uses_at_http_boundary() {
        let request = CreateInviteRequest {
            role: InviteRole::Player,
            expires_at: None,
            max_uses: Some(MAX_INVITE_USES + 1),
        };

        assert!(matches!(request.validate(), Err(ApiError::BadRequest(_))));
    }
}
