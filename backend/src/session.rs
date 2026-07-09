use std::sync::Arc;

use axum::{extract::State, response::IntoResponse, Json};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::{
    auth::{get_authenticated_user, read_signed_cookie, remove_cookie, SESSION_COOKIE_NAME},
    error::ApiError,
    state::AppState,
    users::{AuthUser, GameRole, PlatformRole},
};

#[derive(Debug, Serialize, Deserialize)]
struct AuthSessionResponse {
    authenticated: bool,
    user: Option<SessionUser>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionUser {
    id: i64,
    email: String,
    display_name: Option<String>,
    platform_role: PlatformRole,
    game_role: GameRole,
}

impl From<AuthUser> for SessionUser {
    fn from(user: AuthUser) -> Self {
        Self {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            platform_role: user.platform_role,
            game_role: user.game_role,
        }
    }
}

pub(crate) async fn get_session(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let user = get_authenticated_user(&state, &jar).await?;

    Ok(Json(AuthSessionResponse {
        authenticated: user.is_some(),
        user: user.map(SessionUser::from),
    }))
}

pub(crate) async fn logout(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(session_id) = read_signed_cookie(&state.config, &jar, SESSION_COOKIE_NAME) {
        state
            .user_store
            .delete_session(&session_id)
            .await
            .map_err(|err| {
                error!("logout session delete error: {err}");
                ApiError::Internal
            })?;
    }

    let jar = remove_cookie(&state.config, jar, SESSION_COOKIE_NAME);

    Ok((jar, Json(serde_json::json!({ "ok": true }))))
}
