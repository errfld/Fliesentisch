use std::{collections::BTreeSet, sync::Arc};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::{
    auth::require_authenticated,
    error::{store_to_api_error, ApiError},
    state::AppState,
    users::{AuthUser, CampaignInput, CampaignPreset, GameRole, PlatformRole},
};

const MAX_CAMPAIGN_NAME_LENGTH: usize = 80;
const MAX_ROOM_SLUG_LENGTH: usize = 96;
const MAX_SPLIT_ROOM_NAME_LENGTH: usize = 48;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CampaignsResponse {
    pub(crate) campaigns: Vec<CampaignPreset>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CampaignDirectoryResponse {
    pub(crate) users: Vec<CampaignDirectoryUser>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct CampaignDirectoryUser {
    pub(crate) id: i64,
    pub(crate) email: String,
    pub(crate) display_name: Option<String>,
    pub(crate) game_role: GameRole,
    pub(crate) is_active: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CampaignRequest {
    display_name: String,
    room_slug: String,
    #[serde(default)]
    gamemaster_user_ids: Vec<i64>,
    #[serde(default)]
    player_user_ids: Vec<i64>,
    #[serde(default)]
    default_split_room_names: Vec<String>,
    #[serde(default)]
    is_archived: bool,
}

impl CampaignRequest {
    fn validate(&self) -> Result<(), ApiError> {
        let display_name = self.display_name.trim();
        if display_name.is_empty() || display_name.chars().count() > MAX_CAMPAIGN_NAME_LENGTH {
            return Err(ApiError::BadRequest(format!(
                "`display_name` must be between 1 and {MAX_CAMPAIGN_NAME_LENGTH} characters"
            )));
        }
        let room_slug = self.room_slug.trim();
        if room_slug.is_empty()
            || room_slug.chars().count() > MAX_ROOM_SLUG_LENGTH
            || room_slug.starts_with("__vt_")
            || !room_slug
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        {
            return Err(ApiError::BadRequest(
                "`room_slug` must use only letters, numbers, dashes, or underscores".to_string(),
            ));
        }
        if self.default_split_room_names.iter().any(|name| {
            name.trim().is_empty() || name.trim().chars().count() > MAX_SPLIT_ROOM_NAME_LENGTH
        }) {
            return Err(ApiError::BadRequest(format!(
                "split room names must be between 1 and {MAX_SPLIT_ROOM_NAME_LENGTH} characters"
            )));
        }
        let gamemaster_ids = self
            .gamemaster_user_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let player_ids = self
            .player_user_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        if gamemaster_ids.len() != self.gamemaster_user_ids.len()
            || player_ids.len() != self.player_user_ids.len()
            || !gamemaster_ids.is_disjoint(&player_ids)
        {
            return Err(ApiError::BadRequest(
                "campaign members must appear exactly once with one role".to_string(),
            ));
        }
        Ok(())
    }

    fn into_input(mut self, manager: &AuthUser) -> CampaignInput {
        if manager.platform_role != PlatformRole::Admin
            && !self.gamemaster_user_ids.contains(&manager.id)
        {
            self.gamemaster_user_ids.push(manager.id);
        }
        CampaignInput {
            display_name: self.display_name,
            room_slug: self.room_slug,
            gamemaster_user_ids: self.gamemaster_user_ids,
            player_user_ids: self.player_user_ids,
            default_split_room_names: self.default_split_room_names,
            is_archived: self.is_archived,
        }
    }
}

pub(crate) async fn list_available_campaigns(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_authenticated(&state, &jar).await?;
    let campaigns = state
        .user_store
        .list_campaigns_for_user(user.id, user.platform_role == PlatformRole::Admin)
        .await
        .map_err(store_to_api_error)?;
    Ok(Json(CampaignsResponse { campaigns }))
}

pub(crate) async fn list_managed_campaigns(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let manager = require_campaign_manager(&state, &jar).await?;
    let campaigns = state
        .user_store
        .list_managed_campaigns(manager.id, manager.platform_role == PlatformRole::Admin)
        .await
        .map_err(store_to_api_error)?;
    Ok(Json(CampaignsResponse { campaigns }))
}

pub(crate) async fn list_campaign_directory(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    require_campaign_manager(&state, &jar).await?;
    let users = state
        .user_store
        .list_users()
        .await
        .map_err(store_to_api_error)?
        .into_iter()
        .filter(|user| user.is_active)
        .map(|user| CampaignDirectoryUser {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            game_role: user.game_role,
            is_active: user.is_active,
        })
        .collect();
    Ok(Json(CampaignDirectoryResponse { users }))
}

pub(crate) async fn create_campaign(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(request): Json<CampaignRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let manager = require_campaign_manager(&state, &jar).await?;
    request.validate()?;
    validate_campaign_members(&state, &request).await?;
    let campaign = state
        .user_store
        .create_campaign(manager.id, request.into_input(&manager))
        .await
        .map_err(store_to_api_error)?;
    Ok((StatusCode::CREATED, Json(campaign)))
}

pub(crate) async fn update_campaign(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(campaign_id): Path<i64>,
    Json(request): Json<CampaignRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let manager = require_campaign_manager(&state, &jar).await?;
    require_campaign_access(&state, &manager, campaign_id).await?;
    request.validate()?;
    validate_campaign_members(&state, &request).await?;
    let campaign = state
        .user_store
        .update_campaign(campaign_id, request.into_input(&manager))
        .await
        .map_err(store_to_api_error)?;
    Ok(Json(campaign))
}

async fn validate_campaign_members(
    state: &AppState,
    request: &CampaignRequest,
) -> Result<(), ApiError> {
    let user_ids = request
        .gamemaster_user_ids
        .iter()
        .chain(&request.player_user_ids)
        .copied()
        .collect::<Vec<_>>();
    if !state
        .user_store
        .users_are_active(&user_ids)
        .await
        .map_err(store_to_api_error)?
    {
        return Err(ApiError::BadRequest(
            "campaign members must reference active users".to_string(),
        ));
    }
    Ok(())
}

pub(crate) async fn archive_campaign(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(campaign_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    let manager = require_campaign_manager(&state, &jar).await?;
    require_campaign_access(&state, &manager, campaign_id).await?;
    state
        .user_store
        .archive_campaign(campaign_id)
        .await
        .map_err(store_to_api_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn require_campaign_manager(state: &AppState, jar: &CookieJar) -> Result<AuthUser, ApiError> {
    let user = require_authenticated(state, jar).await?;
    if user.platform_role != PlatformRole::Admin && user.game_role != GameRole::Gamemaster {
        return Err(ApiError::Forbidden(
            "gamemaster or admin access is required".to_string(),
        ));
    }
    Ok(user)
}

async fn require_campaign_access(
    state: &AppState,
    manager: &AuthUser,
    campaign_id: i64,
) -> Result<(), ApiError> {
    let allowed = state
        .user_store
        .user_can_manage_campaign(
            campaign_id,
            manager.id,
            manager.platform_role == PlatformRole::Admin,
        )
        .await
        .map_err(|err| {
            error!("campaign permission check failed: {err}");
            ApiError::Internal
        })?;
    if !allowed {
        return Err(ApiError::Forbidden(
            "you do not manage this campaign".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_campaign_names_and_slug() {
        let valid = CampaignRequest {
            display_name: "Thursday Night".to_string(),
            room_slug: "thursday-night".to_string(),
            gamemaster_user_ids: vec![1],
            player_user_ids: vec![2],
            default_split_room_names: vec!["Library".to_string()],
            is_archived: false,
        };
        assert!(valid.validate().is_ok());

        let invalid = CampaignRequest {
            room_slug: "not a slug".to_string(),
            ..valid
        };
        assert!(matches!(invalid.validate(), Err(ApiError::BadRequest(_))));

        let reserved = CampaignRequest {
            room_slug: "__vt_lobby__table".to_string(),
            ..invalid
        };
        assert!(matches!(reserved.validate(), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_duplicate_or_contradictory_memberships() {
        let duplicate = CampaignRequest {
            display_name: "Thursday Night".to_string(),
            room_slug: "thursday-night".to_string(),
            gamemaster_user_ids: vec![1, 1],
            player_user_ids: vec![],
            default_split_room_names: vec![],
            is_archived: false,
        };
        assert!(matches!(duplicate.validate(), Err(ApiError::BadRequest(_))));

        let overlap = CampaignRequest {
            gamemaster_user_ids: vec![1],
            player_user_ids: vec![1],
            ..duplicate
        };
        assert!(matches!(overlap.validate(), Err(ApiError::BadRequest(_))));
    }
}
