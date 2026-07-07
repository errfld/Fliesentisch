mod admin;
mod auth;
mod config;
mod error;
mod session;
mod token;
mod users;

use admin::{create_admin_user, delete_admin_user, list_admin_users, update_admin_user};
use auth::{dev_login, handle_google_callback, start_google_login};
use axum::{
    extract::State,
    http::{
        header::{ACCEPT, CONTENT_TYPE},
        HeaderValue, Method,
    },
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use config::AppConfig;
use error::ApiError;
use hmac::{Hmac, KeyInit, Mac};
use rand::{rngs::SysRng, TryRng};
use reqwest::Client;
use session::{get_session, logout};
use sha2::Sha256;
use std::{net::SocketAddr, sync::Arc, time::Duration as StdDuration};
use token::mint_token;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{error, info};
use users::{AuthUser, PlatformRole, StoreError, UserStore};

pub(crate) const SESSION_COOKIE_NAME: &str = "vt_session";
pub(crate) const MAX_DISPLAY_NAME_LENGTH: usize = 48;

type HmacSha256 = Hmac<Sha256>;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = match AppConfig::from_env() {
        Ok(cfg) => cfg,
        Err(err) => {
            error!("config error: {err}");
            std::process::exit(1);
        }
    };

    let user_store = match UserStore::connect(&config.database_url).await {
        Ok(store) => store,
        Err(err) => {
            error!("user store init error: {err}");
            std::process::exit(1);
        }
    };

    if let Err(err) = user_store
        .seed_bootstrap_users(&config.bootstrap_users)
        .await
    {
        error!("user bootstrap error: {err}");
        std::process::exit(1);
    }

    let bind_addr: SocketAddr = config
        .bind_addr
        .parse()
        .unwrap_or_else(|_| "0.0.0.0:8787".parse().expect("valid fallback bind addr"));

    info!("auth database initialized at {}", config.database_url);

    let http_client = match Client::builder()
        .connect_timeout(StdDuration::from_secs(5))
        .timeout(StdDuration::from_secs(15))
        .pool_idle_timeout(StdDuration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            error!("http client init error: {err}");
            std::process::exit(1);
        }
    };

    let state = Arc::new(AppState {
        http_client,
        config,
        user_store,
    });
    let app = build_router(state);

    info!("auth service listening on {bind_addr}");
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .expect("bind listener");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("serve app");
}

fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/auth/session", get(get_session))
        .route("/api/v1/auth/google/login", get(start_google_login))
        .route("/api/v1/auth/google/callback", get(handle_google_callback))
        .route("/api/v1/auth/dev-login", get(dev_login))
        .route("/api/v1/auth/logout", post(logout))
        .route(
            "/api/v1/admin/users",
            get(list_admin_users).post(create_admin_user),
        )
        .route(
            "/api/v1/admin/users/{user_id}",
            patch(update_admin_user).delete(delete_admin_user),
        )
        .route("/api/v1/token", post(mint_token))
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer(&state.config.frontend_origins))
        .with_state(state)
}

fn cors_layer(frontend_origins: &[String]) -> CorsLayer {
    if frontend_origins.is_empty() {
        return CorsLayer::new()
            .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
            .allow_headers([ACCEPT, CONTENT_TYPE])
            .allow_origin(Any);
    }

    let origins = frontend_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect::<Vec<_>>();

    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([ACCEPT, CONTENT_TYPE])
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
}

async fn health(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    let user_count = state.user_store.count_users().await.map_err(|err| {
        error!("health user count error: {err}");
        ApiError::Internal
    })?;

    Ok(Json(serde_json::json!({
        "status": "ok",
        "users": {
            "count": user_count,
        }
    })))
}

pub(crate) async fn get_authenticated_user(
    state: &AppState,
    jar: &CookieJar,
) -> Result<Option<AuthUser>, ApiError> {
    let Some(session_id) = read_signed_cookie(&state.config, jar, SESSION_COOKIE_NAME) else {
        return Ok(None);
    };

    let user = state
        .user_store
        .get_session_user(&session_id)
        .await
        .map_err(|err| {
            error!("get session user error: {err}");
            ApiError::Internal
        })?;

    Ok(user.filter(|value| value.is_active))
}

pub(crate) async fn require_authenticated(
    state: &AppState,
    jar: &CookieJar,
) -> Result<AuthUser, ApiError> {
    get_authenticated_user(state, jar)
        .await?
        .ok_or(ApiError::Unauthenticated)
}

pub(crate) async fn require_admin(state: &AppState, jar: &CookieJar) -> Result<AuthUser, ApiError> {
    let user = require_authenticated(state, jar).await?;
    if user.platform_role != PlatformRole::Admin {
        return Err(ApiError::Forbidden(
            "admin access is required for this operation".to_string(),
        ));
    }

    Ok(user)
}

pub(crate) fn store_to_api_error(err: StoreError) -> ApiError {
    match err {
        StoreError::UserNotFound(_) => ApiError::NotFound("user not found".to_string()),
        StoreError::InvalidEmail(message) => ApiError::BadRequest(message),
        StoreError::EmailAlreadyExists(message) => ApiError::Conflict(message),
        StoreError::LastAdminRemoval => ApiError::Conflict(err.to_string()),
        StoreError::UnknownUser(_) => ApiError::Forbidden(err.to_string()),
        StoreError::InactiveUser(_) => ApiError::Forbidden(err.to_string()),
        StoreError::GoogleSubjectMismatch(_, _) => ApiError::Forbidden(err.to_string()),
        other => {
            error!("store error: {other}");
            ApiError::Internal
        }
    }
}

pub(crate) fn set_cookie(
    config: &AppConfig,
    jar: CookieJar,
    name: &str,
    value: &str,
    persistent: bool,
) -> CookieJar {
    let mut builder = Cookie::build((name.to_string(), value.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(config.secure_cookies);

    if persistent {
        builder = builder.max_age(time::Duration::seconds(config.session_ttl_seconds as i64));
    }

    jar.add(builder.build())
}

pub(crate) fn remove_cookie(config: &AppConfig, jar: CookieJar, name: &str) -> CookieJar {
    jar.remove(
        Cookie::build((name.to_string(), String::new()))
            .path("/")
            .http_only(true)
            .same_site(SameSite::Lax)
            .secure(config.secure_cookies)
            .build(),
    )
}

pub(crate) fn read_signed_cookie(
    config: &AppConfig,
    jar: &CookieJar,
    name: &str,
) -> Option<String> {
    let value = jar.get(name)?.value().to_string();
    verify_signed_value(&config.cookie_secret, &value)
}

pub(crate) fn signed_value(secret: &str, value: &str) -> Result<String, ApiError> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| ApiError::Internal)?;
    mac.update(value.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    Ok(format!("{value}.{signature}"))
}

fn verify_signed_value(secret: &str, input: &str) -> Option<String> {
    let (value, signature) = input.rsplit_once('.')?;
    let expected_signature = URL_SAFE_NO_PAD.decode(signature.as_bytes()).ok()?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(value.as_bytes());
    mac.verify_slice(&expected_signature).ok()?;

    Some(value.to_string())
}

pub(crate) fn random_token(num_bytes: usize) -> Result<String, ApiError> {
    let mut bytes = vec![0_u8; num_bytes];
    SysRng.try_fill_bytes(&mut bytes).map_err(|err| {
        error!("secure random generation failed: {err}");
        ApiError::Internal
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

#[derive(Debug, Clone)]
pub(crate) struct AppState {
    pub(crate) http_client: Client,
    pub(crate) config: AppConfig,
    pub(crate) user_store: UserStore,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        admin::AdminUsersResponse, config::parse_optional_set, users::build_bootstrap_users,
    };
    use axum::{body::Body, http::Request, http::StatusCode};
    use chrono::{Duration, Utc};
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
    use token::{derive_room_identity, LiveKitClaims, TokenResponse};
    use tower::ServiceExt;
    use url::Url;

    async fn test_state() -> Arc<AppState> {
        let user_store = UserStore::connect("sqlite::memory:").await.unwrap();
        let bootstrap_users = build_bootstrap_users(
            &["gm@example.com".to_string()],
            &["gm@example.com".to_string()],
            &["player@example.com".to_string()],
        )
        .unwrap();
        user_store
            .seed_bootstrap_users(&bootstrap_users)
            .await
            .unwrap();

        Arc::new(AppState {
            http_client: Client::new(),
            config: AppConfig {
                bind_addr: "127.0.0.1:8787".to_string(),
                database_url: "sqlite::memory:".to_string(),
                bootstrap_users: vec![],
                livekit_api_key: "devkey".to_string(),
                livekit_api_secret: "devsecret".to_string(),
                google_client_id: "google-client".to_string(),
                google_client_secret: "google-secret".to_string(),
                google_redirect_uri: "http://localhost:3000/api/v1/auth/google/callback"
                    .to_string(),
                auth_base_url: Url::parse("http://localhost:3000/").unwrap(),
                cookie_secret: "cookie-secret".to_string(),
                allowed_rooms: parse_optional_set(Some("dnd-table-1".to_string())),
                token_ttl_seconds: 3600,
                session_ttl_seconds: 7200,
                frontend_origins: vec!["http://localhost:3000".to_string()],
                secure_cookies: false,
                enable_dev_login: true,
            },
            user_store,
        })
    }

    async fn session_cookie_for(state: &Arc<AppState>, email: &str, subject: &str) -> String {
        let user = state
            .user_store
            .authorize_google_user(email, subject, Some("Alice"))
            .await
            .unwrap();
        let session_id = random_token(16).unwrap();
        state
            .user_store
            .create_session(&session_id, user.id, Utc::now() + Duration::hours(1))
            .await
            .unwrap();

        let value = signed_value(&state.config.cookie_secret, &session_id).unwrap();
        format!("{SESSION_COOKIE_NAME}={value}")
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let app = build_router(test_state().await);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn session_endpoint_reports_authenticated_user() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let app = build_router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/session")
                    .header("cookie", cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn token_endpoint_requires_authenticated_session() {
        let app = build_router(test_state().await);

        let payload = serde_json::json!({
            "room": "dnd-table-1",
            "name": "Alice"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_endpoint_rejects_unauthenticated_before_room_allowlist() {
        let app = build_router(test_state().await);

        let payload = serde_json::json!({
            "room": "room-c",
            "name": "Alice"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_endpoint_returns_jwt_when_authenticated() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let app = build_router(state.clone());

        let payload = serde_json::json!({
            "room": "dnd-table-1",
            "name": "Alice"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", cookie)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let parsed: TokenResponse = serde_json::from_slice(&body).unwrap();

        let decoded = decode::<LiveKitClaims>(
            &parsed.token,
            &DecodingKey::from_secret("devsecret".as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .unwrap();
        assert_eq!(decoded.claims.video.room, "dnd-table-1");
        assert_eq!(decoded.claims.sub, parsed.identity);
        assert_eq!(
            parsed.identity,
            derive_room_identity(&state.config.cookie_secret, "google-player").unwrap()
        );
        assert_ne!(parsed.identity, "google-player");
    }

    #[tokio::test]
    async fn token_endpoint_rejects_disallowed_room() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let app = build_router(state);

        let payload = serde_json::json!({
            "room": "room-c",
            "name": "Alice"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", cookie)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn admin_update_rejects_last_admin_demotion() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "gm@example.com", "google-gm").await;
        let gm = state
            .user_store
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let app = build_router(state);

        let payload = serde_json::json!({
            "platform_role": "USER"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/admin/users/{}", gm.id))
                    .method("PATCH")
                    .header("content-type", "application/json")
                    .header("cookie", cookie)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn admin_can_create_and_list_users() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "gm@example.com", "google-gm").await;
        let app = build_router(state.clone());

        let create_payload = serde_json::json!({
            "email": "new@example.com",
            "display_name": "New Player",
            "platform_role": "USER",
            "game_role": "PLAYER",
            "is_active": true
        });

        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/users")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", &cookie)
                    .body(Body::from(create_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(create_response.status(), StatusCode::CREATED);

        let list_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/users")
                    .header("cookie", cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(list_response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(list_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let parsed: AdminUsersResponse = serde_json::from_slice(&body).unwrap();
        assert!(parsed
            .users
            .iter()
            .any(|user| user.email == "new@example.com"));
    }
}
