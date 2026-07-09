use std::{collections::BTreeMap, sync::Arc};

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, KeyInit, Mac};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tracing::error;

use crate::{
    auth::require_authenticated,
    error::ApiError,
    state::AppState,
    users::{GameRole, PlatformRole, MAX_DISPLAY_NAME_LENGTH},
};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
pub(crate) struct TokenRequest {
    room: String,
    name: String,
}

impl TokenRequest {
    fn validate(&self) -> Result<(), ApiError> {
        if self.room.trim().is_empty() {
            return Err(ApiError::BadRequest("`room` must not be empty".to_string()));
        }

        let nickname = self.name.trim();
        if nickname.is_empty() {
            return Err(ApiError::BadRequest("`name` must not be empty".to_string()));
        }
        if nickname.chars().count() > MAX_DISPLAY_NAME_LENGTH {
            return Err(ApiError::BadRequest(format!(
                "`name` must be at most {MAX_DISPLAY_NAME_LENGTH} characters"
            )));
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct TokenResponse {
    pub(crate) token: String,
    pub(crate) expires_at: DateTime<Utc>,
    pub(crate) identity: String,
    pub(crate) game_role: GameRole,
    pub(crate) platform_role: PlatformRole,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LiveKitClaims {
    pub(crate) iss: String,
    pub(crate) sub: String,
    pub(crate) name: String,
    pub(crate) nbf: i64,
    pub(crate) exp: i64,
    pub(crate) attributes: BTreeMap<String, String>,
    pub(crate) video: LiveKitVideoGrant,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LiveKitVideoGrant {
    pub(crate) room: String,
    #[serde(rename = "roomJoin")]
    pub(crate) room_join: bool,
    #[serde(rename = "canPublish")]
    pub(crate) can_publish: bool,
    #[serde(rename = "canSubscribe")]
    pub(crate) can_subscribe: bool,
}

pub(crate) async fn mint_token(
    State(state): State<Arc<AppState>>,
    jar: axum_extra::extract::cookie::CookieJar,
    Json(req): Json<TokenRequest>,
) -> Result<impl IntoResponse, ApiError> {
    req.validate()?;
    let user = require_authenticated(&state, &jar).await?;

    let campaign = state
        .user_store
        .find_campaign_by_room_slug(&req.room)
        .await
        .map_err(|err| {
            error!("campaign room lookup failed: {err}");
            ApiError::Internal
        })?;
    let (room, effective_game_role) = if let Some(campaign) = campaign {
        let membership_role = state
            .user_store
            .campaign_role_for_user(campaign.id, user.id)
            .await
            .map_err(|err| {
                error!("campaign membership lookup failed: {err}");
                ApiError::Internal
            })?;
        let campaign_role = if user.platform_role == PlatformRole::Admin {
            GameRole::Gamemaster
        } else {
            membership_role.ok_or_else(|| ApiError::RoomNotAllowed(req.room.clone()))?
        };
        if campaign.is_archived {
            return Err(ApiError::RoomNotAllowed(req.room.clone()));
        }
        (campaign.room_slug, campaign_role)
    } else if state
        .invite_store
        .is_user_invite_restricted(user.id)
        .await
        .map_err(|err| {
            error!("invite access scope lookup failed: {err}");
            ApiError::Internal
        })?
        && user.platform_role != PlatformRole::Admin
        && user.game_role != GameRole::Gamemaster
    {
        return Err(ApiError::RoomNotAllowed(req.room.clone()));
    } else if let Some(allowed_rooms) = &state.config.allowed_rooms {
        if !allowed_rooms.contains(&req.room) {
            return Err(ApiError::RoomNotAllowed(req.room.clone()));
        }
        (req.room.clone(), user.game_role)
    } else {
        (req.room.clone(), user.game_role)
    };

    let google_subject = user.google_subject.clone().ok_or_else(|| {
        ApiError::Forbidden("authenticated user is missing Google identity".to_string())
    })?;
    let opaque_identity = derive_room_identity(&state.config.cookie_secret, &google_subject)?;
    let nickname = req.name.trim();

    let updated_user = state
        .user_store
        .update_user_display_name(user.id, Some(nickname))
        .await
        .map_err(|err| {
            error!("update display name error: {err}");
            ApiError::Internal
        })?;

    let now = Utc::now();
    let expiry = token_expiry(now, state.config.token_ttl_seconds)?;

    let attributes = BTreeMap::from([
        (
            "game_role".to_string(),
            effective_game_role.as_str().to_string(),
        ),
        (
            "platform_role".to_string(),
            updated_user.platform_role.as_str().to_string(),
        ),
    ]);
    let claims = LiveKitClaims {
        iss: state.config.livekit_api_key.clone(),
        sub: opaque_identity,
        name: updated_user
            .display_name
            .unwrap_or_else(|| nickname.to_string()),
        nbf: now.timestamp(),
        exp: expiry.timestamp(),
        attributes,
        video: LiveKitVideoGrant {
            room_join: true,
            room,
            can_publish: true,
            can_subscribe: true,
        },
    };

    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(state.config.livekit_api_secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)?;

    Ok((
        StatusCode::OK,
        Json(TokenResponse {
            token,
            expires_at: expiry,
            identity: claims.sub,
            game_role: effective_game_role,
            platform_role: updated_user.platform_role,
        }),
    ))
}

pub(crate) fn derive_room_identity(secret: &str, google_subject: &str) -> Result<String, ApiError> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| ApiError::Internal)?;
    mac.update(b"livekit-identity:");
    mac.update(google_subject.as_bytes());
    Ok(format!(
        "u_{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    ))
}

fn token_expiry(now: DateTime<Utc>, token_ttl_seconds: u64) -> Result<DateTime<Utc>, ApiError> {
    let ttl_seconds = i64::try_from(token_ttl_seconds).map_err(|err| {
        error!("token TTL exceeds supported duration range: {err}");
        ApiError::Internal
    })?;
    let ttl = Duration::try_seconds(ttl_seconds).ok_or_else(|| {
        error!("token TTL exceeds supported duration range");
        ApiError::Internal
    })?;
    now.checked_add_signed(ttl).ok_or_else(|| {
        error!("token TTL would produce an unsupported expiry timestamp");
        ApiError::Internal
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_request_rejects_empty_room_or_name() {
        assert!(matches!(
            TokenRequest {
                room: " ".to_string(),
                name: "Alice".to_string(),
            }
            .validate(),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            TokenRequest {
                room: "table".to_string(),
                name: " ".to_string(),
            }
            .validate(),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn room_identity_is_stable_and_opaque() {
        let first = derive_room_identity("secret", "google-subject").unwrap();
        let second = derive_room_identity("secret", "google-subject").unwrap();
        let different_subject = derive_room_identity("secret", "other-subject").unwrap();

        assert_eq!(first, second);
        assert_ne!(first, different_subject);
        assert!(first.starts_with("u_"));
        assert!(!first.contains("google-subject"));
    }

    #[test]
    fn token_expiry_rejects_oversized_ttl() {
        let now = DateTime::<Utc>::from_timestamp(0, 0).unwrap();

        assert_eq!(
            token_expiry(now, 3_600).unwrap(),
            DateTime::<Utc>::from_timestamp(3_600, 0).unwrap()
        );
        assert!(matches!(
            token_expiry(now, i64::MAX as u64 + 1),
            Err(ApiError::Internal)
        ));
    }
}
