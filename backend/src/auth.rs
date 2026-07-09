use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::{ConnectInfo, Query, State},
    response::{IntoResponse, Redirect},
};
use axum_extra::extract::cookie::CookieJar;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tracing::error;
use url::Url;

use crate::{
    config::AppConfig,
    error::ApiError,
    random_token, remove_cookie, set_cookie, signed_value, store_to_api_error,
    users::{AuthUser, StoreError},
    AppState, SESSION_COOKIE_NAME,
};

const OAUTH_STATE_COOKIE_NAME: &str = "vt_oauth_state";
const OAUTH_VERIFIER_COOKIE_NAME: &str = "vt_oauth_verifier";
const OAUTH_NEXT_COOKIE_NAME: &str = "vt_oauth_next";
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const UNAUTHORIZED_PATH: &str = "/auth/unauthorized";
const DEFAULT_AUTH_REDIRECT: &str = "/";

pub(crate) async fn start_google_login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Query(params): Query<LoginQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let state_token = random_token(24)?;
    let pkce_verifier = random_token(32)?;
    let next = sanitize_next_path(params.next.as_deref());
    let pkce_challenge = pkce_challenge(&pkce_verifier);

    let mut auth_url = Url::parse(GOOGLE_AUTH_URL).map_err(|_| ApiError::Internal)?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &state.config.google_client_id)
        .append_pair("redirect_uri", &state.config.google_redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state_token)
        .append_pair("code_challenge", &pkce_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");

    let jar = set_cookie(
        &state.config,
        jar,
        OAUTH_STATE_COOKIE_NAME,
        &signed_value(&state.config.cookie_secret, &state_token)?,
        false,
    );
    let jar = set_cookie(
        &state.config,
        jar,
        OAUTH_VERIFIER_COOKIE_NAME,
        &signed_value(&state.config.cookie_secret, &pkce_verifier)?,
        false,
    );
    let jar = set_cookie(
        &state.config,
        jar,
        OAUTH_NEXT_COOKIE_NAME,
        &signed_value(&state.config.cookie_secret, &next)?,
        false,
    );

    Ok((jar, Redirect::to(auth_url.as_str())))
}

pub(crate) async fn handle_google_callback(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Query(params): Query<GoogleCallbackQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let next = crate::read_signed_cookie(&state.config, &jar, OAUTH_NEXT_COOKIE_NAME)
        .unwrap_or_else(|| DEFAULT_AUTH_REDIRECT.to_string());
    let expected_state = crate::read_signed_cookie(&state.config, &jar, OAUTH_STATE_COOKIE_NAME);
    let pkce_verifier = crate::read_signed_cookie(&state.config, &jar, OAUTH_VERIFIER_COOKIE_NAME);
    let clear_jar = clear_oauth_cookies(&state.config, jar);

    if let Some(error_code) = params.error.as_deref() {
        let redirect = unauthorized_redirect(&state.config, "google_denied", Some(error_code))?;
        return Ok((clear_jar, Redirect::to(&redirect)));
    }

    let Some(code) = params.code.as_deref() else {
        let redirect = unauthorized_redirect(
            &state.config,
            "missing_code",
            params.error_description.as_deref(),
        )?;
        return Ok((clear_jar, Redirect::to(&redirect)));
    };

    let Some(expected_state) = expected_state else {
        let redirect = unauthorized_redirect(&state.config, "missing_state", None)?;
        return Ok((clear_jar, Redirect::to(&redirect)));
    };
    let Some(pkce_verifier) = pkce_verifier else {
        let redirect = unauthorized_redirect(&state.config, "missing_verifier", None)?;
        return Ok((clear_jar, Redirect::to(&redirect)));
    };

    if params.state.as_deref() != Some(expected_state.as_str()) {
        let redirect = unauthorized_redirect(&state.config, "state_mismatch", None)?;
        return Ok((clear_jar, Redirect::to(&redirect)));
    }

    let google_user = match exchange_google_code(&state, code, &pkce_verifier).await {
        Ok(user) => user,
        Err(err) => {
            error!("google oauth exchange error: {err}");
            let redirect = unauthorized_redirect(
                &state.config,
                "oauth_exchange_failed",
                Some("Unable to complete Google sign-in."),
            )?;
            return Ok((clear_jar, Redirect::to(&redirect)));
        }
    };

    if !google_user.email_verified {
        let redirect = unauthorized_redirect(
            &state.config,
            "email_not_verified",
            Some("Google account email must be verified."),
        )?;
        return Ok((clear_jar, Redirect::to(&redirect)));
    }

    let user = match state
        .user_store
        .authorize_google_user(
            &google_user.email,
            &google_user.sub,
            google_user.name.as_deref(),
        )
        .await
    {
        Ok(user) => user,
        Err(StoreError::UnknownUser(_))
        | Err(StoreError::InactiveUser(_))
        | Err(StoreError::GoogleSubjectMismatch(_, _)) => {
            let redirect = unauthorized_redirect(
                &state.config,
                "access_denied",
                Some("Your Google account is not authorized for this table."),
            )?;
            return Ok((clear_jar, Redirect::to(&redirect)));
        }
        Err(err) => {
            error!("authorize google user error: {err}");
            return Err(ApiError::Internal);
        }
    };

    let jar = create_session_cookie(&state, clear_jar, &user).await?;

    Ok((
        jar,
        Redirect::to(&state.config.absolute_frontend_path(&next)),
    ))
}

pub(crate) async fn dev_login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    request: axum::extract::Request,
) -> Result<impl IntoResponse, ApiError> {
    let params = Query::<DevLoginQuery>::try_from_uri(request.uri())
        .map_err(|err| ApiError::BadRequest(err.to_string()))?
        .0;
    if !state.config.enable_dev_login {
        return Err(ApiError::NotFound("not found".to_string()));
    }
    let is_loopback = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|value| value.0.ip().is_loopback())
        .unwrap_or(false);
    if !cfg!(debug_assertions) && !is_loopback {
        return Err(ApiError::NotFound("not found".to_string()));
    }
    if params.email.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "`email` must not be empty".to_string(),
        ));
    }

    let next = sanitize_next_path(params.next.as_deref());
    let normalized_email = params.email.trim().to_lowercase();
    let display_name = params
        .name
        .as_deref()
        .filter(|value| !value.trim().is_empty());

    let user = state
        .user_store
        .authorize_google_user(
            &normalized_email,
            &dev_subject_for_email(&normalized_email),
            display_name,
        )
        .await
        .map_err(store_to_api_error)?;

    let jar = create_session_cookie(&state, jar, &user).await?;
    Ok((
        jar,
        Redirect::to(&state.config.absolute_frontend_path(&next)),
    ))
}

async fn exchange_google_code(
    state: &AppState,
    code: &str,
    code_verifier: &str,
) -> Result<GoogleUserInfo, ApiError> {
    let token_response = state
        .http_client
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("code", code),
            ("client_id", state.config.google_client_id.as_str()),
            ("client_secret", state.config.google_client_secret.as_str()),
            ("redirect_uri", state.config.google_redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|err| {
            error!("Google token exchange send error: {err:?}");
            ApiError::Internal
        })?;

    if !token_response.status().is_success() {
        let status = token_response.status();
        let body = token_response
            .text()
            .await
            .unwrap_or_else(|err| format!("<failed to read response body: {err}>"));
        error!("Google token exchange failed: status={status}, body={body}");
        return Err(ApiError::Internal);
    }

    let token_body: GoogleTokenResponse = token_response.json().await.map_err(|err| {
        error!("Google token exchange response parse error: {err:?}");
        ApiError::Internal
    })?;

    let userinfo_response = state
        .http_client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(token_body.access_token)
        .send()
        .await
        .map_err(|err| {
            error!("Google userinfo fetch send error: {err:?}");
            ApiError::Internal
        })?;

    if !userinfo_response.status().is_success() {
        let status = userinfo_response.status();
        let body = userinfo_response
            .text()
            .await
            .unwrap_or_else(|err| format!("<failed to read response body: {err}>"));
        error!("Google userinfo fetch failed: status={status}, body={body}");
        return Err(ApiError::Internal);
    }

    userinfo_response.json().await.map_err(|err| {
        error!("Google userinfo response parse error: {err:?}");
        ApiError::Internal
    })
}

async fn create_session_cookie(
    state: &AppState,
    jar: CookieJar,
    user: &AuthUser,
) -> Result<CookieJar, ApiError> {
    let session_id = random_token(32)?;
    let expires_at =
        chrono::Utc::now() + chrono::Duration::seconds(state.config.session_ttl_seconds as i64);
    state
        .user_store
        .create_session(&session_id, user.id, expires_at)
        .await
        .map_err(|err| {
            error!("create session error: {err}");
            ApiError::Internal
        })?;

    let session_cookie_value = signed_value(&state.config.cookie_secret, &session_id)?;
    Ok(set_cookie(
        &state.config,
        jar,
        SESSION_COOKIE_NAME,
        &session_cookie_value,
        true,
    ))
}

fn clear_oauth_cookies(config: &AppConfig, jar: CookieJar) -> CookieJar {
    let jar = remove_cookie(config, jar, OAUTH_STATE_COOKIE_NAME);
    let jar = remove_cookie(config, jar, OAUTH_VERIFIER_COOKIE_NAME);
    remove_cookie(config, jar, OAUTH_NEXT_COOKIE_NAME)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn dev_subject_for_email(email: &str) -> String {
    let digest = Sha256::digest(email.as_bytes());
    format!("dev-{}", URL_SAFE_NO_PAD.encode(digest))
}

fn sanitize_next_path(next: Option<&str>) -> String {
    let Some(next) = next.map(str::trim).filter(|value| !value.is_empty()) else {
        return DEFAULT_AUTH_REDIRECT.to_string();
    };

    if next.starts_with('/') && !next.starts_with("//") {
        next.to_string()
    } else {
        DEFAULT_AUTH_REDIRECT.to_string()
    }
}

fn unauthorized_redirect(
    config: &AppConfig,
    reason: &str,
    detail: Option<&str>,
) -> Result<String, ApiError> {
    let unauthorized_path = config.absolute_frontend_path(UNAUTHORIZED_PATH);
    let mut url = Url::parse(&unauthorized_path).map_err(|err| {
        error!("invalid unauthorized redirect url {unauthorized_path}: {err}");
        ApiError::Internal
    })?;
    url.query_pairs_mut().append_pair("reason", reason);
    if let Some(detail) = detail {
        url.query_pairs_mut().append_pair("detail", detail);
    }
    Ok(url.to_string())
}

#[derive(Debug, Deserialize)]
pub(crate) struct LoginQuery {
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GoogleCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DevLoginQuery {
    email: String,
    name: Option<String>,
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_next_path_accepts_only_relative_absolute_paths() {
        assert_eq!(sanitize_next_path(Some("/rooms/alpha")), "/rooms/alpha");
        assert_eq!(sanitize_next_path(Some("  /rooms/alpha  ")), "/rooms/alpha");
        assert_eq!(sanitize_next_path(Some("//evil.example/path")), "/");
        assert_eq!(sanitize_next_path(Some("https://evil.example/path")), "/");
        assert_eq!(sanitize_next_path(Some("")), "/");
        assert_eq!(sanitize_next_path(None), "/");
    }

    #[test]
    fn dev_subject_is_stable_and_namespaced() {
        let first = dev_subject_for_email("alice@example.com");
        let second = dev_subject_for_email("alice@example.com");
        assert_eq!(first, second);
        assert!(first.starts_with("dev-"));
        assert_ne!(first, dev_subject_for_email("bob@example.com"));
    }
}
