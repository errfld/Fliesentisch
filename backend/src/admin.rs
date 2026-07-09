use std::sync::Arc;

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
    auth::require_admin,
    error::{store_to_api_error, ApiError},
    state::AppState,
    users::{AuthUser, GameRole, NewUser, PlatformRole, UserPatch, MAX_DISPLAY_NAME_LENGTH},
};

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct AdminUsersResponse {
    pub(crate) users: Vec<AdminUser>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct AdminUser {
    pub(crate) id: i64,
    pub(crate) email: String,
    pub(crate) display_name: Option<String>,
    pub(crate) is_linked: bool,
    pub(crate) platform_role: PlatformRole,
    pub(crate) game_role: GameRole,
    pub(crate) is_active: bool,
}

impl From<AuthUser> for AdminUser {
    fn from(user: AuthUser) -> Self {
        Self {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            is_linked: user.google_subject.is_some(),
            platform_role: user.platform_role,
            game_role: user.game_role,
            is_active: user.is_active,
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateUserRequest {
    email: String,
    #[serde(default)]
    display_name: Option<String>,
    platform_role: PlatformRole,
    game_role: GameRole,
    #[serde(default = "default_true")]
    is_active: bool,
}

impl CreateUserRequest {
    fn validate(&self) -> Result<(), ApiError> {
        if self.email.trim().is_empty() {
            return Err(ApiError::BadRequest(
                "`email` must not be empty".to_string(),
            ));
        }
        if let Some(name) = self.display_name.as_deref() {
            if name.trim().chars().count() > MAX_DISPLAY_NAME_LENGTH {
                return Err(ApiError::BadRequest(format!(
                    "`display_name` must be at most {MAX_DISPLAY_NAME_LENGTH} characters"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateUserRequest {
    email: Option<String>,
    display_name: Option<String>,
    platform_role: Option<PlatformRole>,
    game_role: Option<GameRole>,
    is_active: Option<bool>,
}

impl UpdateUserRequest {
    fn validate(&self) -> Result<(), ApiError> {
        if let Some(email) = self.email.as_deref() {
            if email.trim().is_empty() {
                return Err(ApiError::BadRequest(
                    "`email` must not be empty".to_string(),
                ));
            }
        }
        if let Some(name) = self.display_name.as_deref() {
            if name.trim().chars().count() > MAX_DISPLAY_NAME_LENGTH {
                return Err(ApiError::BadRequest(format!(
                    "`display_name` must be at most {MAX_DISPLAY_NAME_LENGTH} characters"
                )));
            }
        }
        Ok(())
    }
}

fn default_true() -> bool {
    true
}

pub(crate) async fn list_admin_users(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &jar).await?;
    let users = state.user_store.list_users().await.map_err(|err| {
        error!("list admin users error: {err}");
        ApiError::Internal
    })?;

    Ok(Json(AdminUsersResponse {
        users: users.into_iter().map(AdminUser::from).collect(),
    }))
}

pub(crate) async fn create_admin_user(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(req): Json<CreateUserRequest>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &jar).await?;
    req.validate()?;

    let user = state
        .user_store
        .create_user(NewUser {
            email: req.email,
            display_name: req.display_name,
            platform_role: req.platform_role,
            game_role: req.game_role,
            is_active: req.is_active,
        })
        .await
        .map_err(store_to_api_error)?;

    Ok((StatusCode::CREATED, Json(AdminUser::from(user))))
}

pub(crate) async fn update_admin_user(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(user_id): Path<i64>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &jar).await?;
    req.validate()?;

    let user = state
        .user_store
        .update_user(
            user_id,
            UserPatch {
                email: req.email,
                display_name: req.display_name,
                platform_role: req.platform_role,
                game_role: req.game_role,
                is_active: req.is_active,
            },
        )
        .await
        .map_err(store_to_api_error)?;

    Ok(Json(AdminUser::from(user)))
}

pub(crate) async fn delete_admin_user(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Path(user_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&state, &jar).await?;
    state
        .user_store
        .delete_user(user_id)
        .await
        .map_err(store_to_api_error)?;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_user_request_rejects_empty_email() {
        let request = CreateUserRequest {
            email: " ".to_string(),
            display_name: None,
            platform_role: PlatformRole::User,
            game_role: GameRole::Player,
            is_active: true,
        };

        assert!(matches!(request.validate(), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn create_user_request_accepts_valid_input() {
        let request = CreateUserRequest {
            email: "new@example.com".to_string(),
            display_name: Some("New Player".to_string()),
            platform_role: PlatformRole::User,
            game_role: GameRole::Player,
            is_active: true,
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn create_user_request_rejects_overlong_display_name() {
        let request = CreateUserRequest {
            email: "new@example.com".to_string(),
            display_name: Some("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1)),
            platform_role: PlatformRole::User,
            game_role: GameRole::Player,
            is_active: true,
        };

        assert!(matches!(request.validate(), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn update_user_request_rejects_blank_email() {
        let request = UpdateUserRequest {
            email: Some("\t".to_string()),
            display_name: None,
            platform_role: None,
            game_role: None,
            is_active: None,
        };

        assert!(matches!(request.validate(), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn update_user_request_accepts_valid_input() {
        let request = UpdateUserRequest {
            email: Some("updated@example.com".to_string()),
            display_name: Some("Updated Player".to_string()),
            platform_role: Some(PlatformRole::Admin),
            game_role: Some(GameRole::Gamemaster),
            is_active: Some(true),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn update_user_request_rejects_overlong_display_name() {
        let request = UpdateUserRequest {
            email: None,
            display_name: Some("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1)),
            platform_role: None,
            game_role: None,
            is_active: None,
        };

        assert!(matches!(request.validate(), Err(ApiError::BadRequest(_))));
    }
}
