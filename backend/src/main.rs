mod users;

use axum::{
    extract::State,
    http::{HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    net::SocketAddr,
    sync::Arc,
};
use thiserror::Error;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{error, info};
use users::{build_bootstrap_users, BootstrapUser, StoredUser, UserStore};

const AUTH_SESSION_COOKIE: &str = "vt_session";

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

    let state = Arc::new(AppState { config, user_store });
    let app = build_router(state);

    info!("auth service listening on {bind_addr}");
    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .expect("bind listener");
    axum::serve(listener, app).await.expect("serve app");
}

fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/session", get(session))
        .route("/api/v1/token", post(mint_token))
        .layer(TraceLayer::new_for_http())
        .layer(cors_layer(&state.config.frontend_origins))
        .with_state(state)
}

fn cors_layer(frontend_origins: &[String]) -> CorsLayer {
    if frontend_origins.is_empty() {
        return CorsLayer::new()
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any)
            .allow_origin(Any);
    }

    let origins = frontend_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect::<Vec<_>>();

    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any)
        .allow_origin(AllowOrigin::list(origins))
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

async fn mint_token(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(req): Json<TokenRequest>,
) -> Result<impl IntoResponse, ApiError> {
    req.validate()?;

    if let Some(allowed_rooms) = &state.config.allowed_rooms {
        if !allowed_rooms.contains(&req.room) {
            return Err(ApiError::RoomNotAllowed(req.room.clone()));
        }
    }

    let session_user = resolve_session_user(&state, &jar).await?;

    if session_user.is_none() {
        if let Some(join_secret) = &state.config.join_secret {
            if req.join_key.as_deref() != Some(join_secret) {
                return Err(ApiError::InvalidJoinKey);
            }
        }
    }

    let now = Utc::now();
    let expiry = now + Duration::seconds(state.config.token_ttl_seconds as i64);
    let game_role = session_user
        .as_ref()
        .map(|user| user.game_role.as_str().to_string());

    let claims = LiveKitClaims {
        iss: state.config.livekit_api_key.clone(),
        sub: req.identity.clone(),
        name: req.name.clone(),
        attributes: build_livekit_attributes(session_user.as_ref()),
        nbf: now.timestamp(),
        exp: expiry.timestamp(),
        video: LiveKitVideoGrant {
            room_join: true,
            room: req.room,
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
            game_role,
            token,
            expires_at: expiry,
        }),
    ))
}

async fn login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    req.validate()?;

    let user = state
        .user_store
        .find_active_user_by_email(&req.email)
        .await
        .map_err(|_| ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;

    let expires_at = Utc::now() + Duration::seconds(state.config.auth_session_ttl_seconds as i64);
    let session_token = create_session_token(&state.config, &user, expires_at)?;
    let cookie = build_session_cookie(session_token, expires_at);

    Ok((
        jar.add(cookie),
        Json(AuthSessionResponse::from_user(user, expires_at)),
    ))
}

async fn logout(jar: CookieJar) -> impl IntoResponse {
    jar.remove(Cookie::from(AUTH_SESSION_COOKIE))
}

async fn session(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let user = resolve_session_user(&state, &jar)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let expires_at = read_session_claims(&state.config, &jar)?
        .map(|claims| claims.expires_at())
        .ok_or(ApiError::Unauthorized)?;

    Ok(Json(AuthSessionResponse::from_user(user, expires_at)))
}

#[derive(Debug, Clone)]
struct AppState {
    config: AppConfig,
    user_store: UserStore,
}

#[derive(Debug, Clone)]
struct AppConfig {
    bind_addr: String,
    database_url: String,
    bootstrap_users: Vec<BootstrapUser>,
    auth_cookie_secret: String,
    auth_session_ttl_seconds: u64,
    livekit_api_key: String,
    livekit_api_secret: String,
    join_secret: Option<String>,
    allowed_rooms: Option<HashSet<String>>,
    token_ttl_seconds: u64,
    frontend_origins: Vec<String>,
}

impl AppConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let livekit_api_key = read_required("LIVEKIT_API_KEY")?;
        let livekit_api_secret = read_required("LIVEKIT_API_SECRET")?;

        let bind_addr = env::var("AUTH_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
        let database_url = env::var("AUTH_DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:///app/data/auth.db?mode=rwc".to_string());
        let auth_cookie_secret = env::var("AUTH_COOKIE_SECRET")
            .unwrap_or_else(|_| "dev-cookie-secret-change-me".to_string());
        let auth_session_ttl_seconds = env::var("AUTH_SESSION_TTL_SECONDS")
            .ok()
            .and_then(|val| val.parse::<u64>().ok())
            .unwrap_or(60 * 60 * 24 * 7);
        let bootstrap_users = build_bootstrap_users(
            &parse_csv(read_optional("AUTH_BOOTSTRAP_ADMIN_EMAILS")),
            &parse_csv(read_optional("AUTH_BOOTSTRAP_GAMEMASTER_EMAILS")),
            &parse_csv(read_optional("AUTH_BOOTSTRAP_PLAYER_EMAILS")),
        )?;
        let join_secret = read_optional("JOIN_SECRET");
        let allowed_rooms = parse_optional_set(read_optional("ALLOWED_ROOMS"));
        let token_ttl_seconds = env::var("TOKEN_TTL_SECONDS")
            .ok()
            .and_then(|val| val.parse::<u64>().ok())
            .unwrap_or(3600);
        let frontend_origins = parse_csv(read_optional("FRONTEND_ORIGINS"));

        Ok(Self {
            bind_addr,
            database_url,
            bootstrap_users,
            auth_cookie_secret,
            auth_session_ttl_seconds,
            livekit_api_key,
            livekit_api_secret,
            join_secret,
            allowed_rooms,
            token_ttl_seconds,
            frontend_origins,
        })
    }
}

#[derive(Debug, Error)]
enum ConfigError {
    #[error("missing required env var: {0}")]
    MissingEnv(&'static str),
    #[error("invalid bootstrap user config: {0}")]
    InvalidBootstrapUsers(String),
}

fn read_required(key: &'static str) -> Result<String, ConfigError> {
    env::var(key).map_err(|_| ConfigError::MissingEnv(key))
}

fn read_optional(key: &'static str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_csv(input: Option<String>) -> Vec<String> {
    input
        .map(|value| {
            value
                .split(',')
                .map(|entry| entry.trim().to_string())
                .filter(|entry| !entry.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn parse_optional_set(input: Option<String>) -> Option<HashSet<String>> {
    let values = parse_csv(input);
    if values.is_empty() {
        None
    } else {
        Some(values.into_iter().collect())
    }
}

impl From<users::StoreError> for ConfigError {
    fn from(value: users::StoreError) -> Self {
        ConfigError::InvalidBootstrapUsers(value.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct TokenRequest {
    room: String,
    identity: String,
    name: String,
    #[serde(default)]
    join_key: Option<String>,
}

impl TokenRequest {
    fn validate(&self) -> Result<(), ApiError> {
        if self.room.trim().is_empty() {
            return Err(ApiError::BadRequest("`room` must not be empty".to_string()));
        }
        if self.identity.trim().is_empty() {
            return Err(ApiError::BadRequest(
                "`identity` must not be empty".to_string(),
            ));
        }
        if self.name.trim().is_empty() {
            return Err(ApiError::BadRequest("`name` must not be empty".to_string()));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    email: String,
}

impl LoginRequest {
    fn validate(&self) -> Result<(), ApiError> {
        if self.email.trim().is_empty() {
            return Err(ApiError::BadRequest(
                "`email` must not be empty".to_string(),
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct TokenResponse {
    token: String,
    expires_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    game_role: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LiveKitClaims {
    iss: String,
    sub: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    attributes: Option<HashMap<String, String>>,
    nbf: i64,
    exp: i64,
    video: LiveKitVideoGrant,
}

#[derive(Debug, Serialize, Deserialize)]
struct LiveKitVideoGrant {
    room: String,
    #[serde(rename = "roomJoin")]
    room_join: bool,
    #[serde(rename = "canPublish")]
    can_publish: bool,
    #[serde(rename = "canSubscribe")]
    can_subscribe: bool,
}

#[derive(Debug, Serialize)]
struct AuthSessionResponse {
    email: String,
    game_role: String,
    platform_role: String,
    expires_at: DateTime<Utc>,
}

impl AuthSessionResponse {
    fn from_user(user: StoredUser, expires_at: DateTime<Utc>) -> Self {
        Self {
            email: user.email,
            game_role: user.game_role.as_str().to_string(),
            platform_role: user.platform_role.as_str().to_string(),
            expires_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionClaims {
    sub: String,
    email: String,
    nbf: i64,
    exp: i64,
}

fn build_livekit_attributes(user: Option<&StoredUser>) -> Option<HashMap<String, String>> {
    let user = user?;
    let mut attributes = HashMap::new();
    attributes.insert("game_role".to_string(), user.game_role.as_str().to_string());
    Some(attributes)
}

impl SessionClaims {
    fn expires_at(&self) -> DateTime<Utc> {
        DateTime::from_timestamp(self.exp, 0).unwrap_or_else(Utc::now)
    }
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("invalid join key")]
    InvalidJoinKey,
    #[error("unauthorized")]
    Unauthorized,
    #[error("room is not allowed: {0}")]
    RoomNotAllowed(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            ApiError::InvalidJoinKey => (
                StatusCode::UNAUTHORIZED,
                "INVALID_JOIN_KEY",
                self.to_string(),
            ),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", self.to_string()),
            ApiError::RoomNotAllowed(_) => {
                (StatusCode::FORBIDDEN, "ROOM_NOT_ALLOWED", self.to_string())
            }
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", self.to_string()),
            ApiError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL",
                "unexpected server error".to_string(),
            ),
        };

        (
            status,
            Json(serde_json::json!({
                "error": {
                    "code": code,
                    "message": message,
                }
            })),
        )
            .into_response()
    }
}

async fn resolve_session_user(
    state: &AppState,
    jar: &CookieJar,
) -> Result<Option<StoredUser>, ApiError> {
    let Some(claims) = read_session_claims(&state.config, jar)? else {
        return Ok(None);
    };

    let user = state
        .user_store
        .find_active_user_by_email(&claims.email)
        .await
        .map_err(|_| ApiError::Internal)?;

    Ok(user)
}

fn read_session_claims(
    config: &AppConfig,
    jar: &CookieJar,
) -> Result<Option<SessionClaims>, ApiError> {
    let Some(cookie) = jar.get(AUTH_SESSION_COOKIE) else {
        return Ok(None);
    };

    let decoded = decode::<SessionClaims>(
        cookie.value(),
        &DecodingKey::from_secret(config.auth_cookie_secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| ApiError::Unauthorized)?;

    Ok(Some(decoded.claims))
}

fn create_session_token(
    config: &AppConfig,
    user: &StoredUser,
    expires_at: DateTime<Utc>,
) -> Result<String, ApiError> {
    let claims = SessionClaims {
        sub: user.normalized_email.clone(),
        email: user.normalized_email.clone(),
        nbf: Utc::now().timestamp(),
        exp: expires_at.timestamp(),
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.auth_cookie_secret.as_bytes()),
    )
    .map_err(|_| ApiError::Internal)
}

fn build_session_cookie(token: String, expires_at: DateTime<Utc>) -> Cookie<'static> {
    let _ = expires_at;
    Cookie::build((AUTH_SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use jsonwebtoken::{decode, DecodingKey, Validation};
    use tower::ServiceExt;

    async fn test_state(join_secret: Option<&str>, allowed_rooms: Option<&str>) -> Arc<AppState> {
        let user_store = UserStore::connect("sqlite::memory:").await.unwrap();
        Arc::new(AppState {
            config: AppConfig {
                bind_addr: "127.0.0.1:8787".to_string(),
                database_url: "sqlite::memory:".to_string(),
                bootstrap_users: vec![],
                auth_cookie_secret: "dev-cookie-secret-change-me".to_string(),
                auth_session_ttl_seconds: 3600,
                livekit_api_key: "devkey".to_string(),
                livekit_api_secret: "devsecret".to_string(),
                join_secret: join_secret.map(ToOwned::to_owned),
                allowed_rooms: parse_optional_set(allowed_rooms.map(ToOwned::to_owned)),
                token_ttl_seconds: 3600,
                frontend_origins: vec!["http://localhost:3000".to_string()],
            },
            user_store,
        })
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let app = build_router(test_state(None, None).await);

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
    async fn login_sets_session_cookie_for_bootstrap_user() {
        let user_store = UserStore::connect("sqlite::memory:").await.unwrap();
        user_store
            .seed_bootstrap_users(
                &build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap(),
            )
            .await
            .unwrap();

        let app = build_router(Arc::new(AppState {
            config: AppConfig {
                bind_addr: "127.0.0.1:8787".to_string(),
                database_url: "sqlite::memory:".to_string(),
                bootstrap_users: vec![],
                auth_cookie_secret: "dev-cookie-secret-change-me".to_string(),
                auth_session_ttl_seconds: 3600,
                livekit_api_key: "devkey".to_string(),
                livekit_api_secret: "devsecret".to_string(),
                join_secret: Some("shh".to_string()),
                allowed_rooms: parse_optional_set(Some("dnd-table-1".to_string())),
                token_ttl_seconds: 3600,
                frontend_origins: vec!["http://localhost:3000".to_string()],
            },
            user_store,
        }));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/login")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":"gm@example.com"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let set_cookie = response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap();
        assert!(set_cookie.contains("vt_session="));
    }

    #[tokio::test]
    async fn token_endpoint_returns_role_for_authenticated_session() {
        let user_store = UserStore::connect("sqlite::memory:").await.unwrap();
        user_store
            .seed_bootstrap_users(
                &build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap(),
            )
            .await
            .unwrap();

        let state = Arc::new(AppState {
            config: AppConfig {
                bind_addr: "127.0.0.1:8787".to_string(),
                database_url: "sqlite::memory:".to_string(),
                bootstrap_users: vec![],
                auth_cookie_secret: "dev-cookie-secret-change-me".to_string(),
                auth_session_ttl_seconds: 3600,
                livekit_api_key: "devkey".to_string(),
                livekit_api_secret: "devsecret".to_string(),
                join_secret: Some("shh".to_string()),
                allowed_rooms: parse_optional_set(Some("dnd-table-1".to_string())),
                token_ttl_seconds: 3600,
                frontend_origins: vec!["http://localhost:3000".to_string()],
            },
            user_store,
        });
        let app = build_router(state.clone());

        let login_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/login")
                    .method("POST")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"email":"gm@example.com"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let set_cookie = login_response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();

        let payload = serde_json::json!({
            "room": "dnd-table-1",
            "identity": "alice",
            "name": "Alice"
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", set_cookie)
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
        assert_eq!(parsed.game_role.as_deref(), Some("gamemaster"));

        let decoded = decode::<LiveKitClaims>(
            &parsed.token,
            &DecodingKey::from_secret("devsecret".as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .unwrap();
        assert_eq!(
            decoded
                .claims
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.get("game_role"))
                .map(String::as_str),
            Some("gamemaster")
        );
    }

    #[tokio::test]
    async fn token_endpoint_returns_jwt_when_valid() {
        let app = build_router(test_state(Some("shh"), Some("dnd-table-1")).await);

        let payload = serde_json::json!({
            "room": "dnd-table-1",
            "identity": "alice",
            "name": "Alice",
            "join_key": "shh"
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
        assert!(decoded.claims.video.room_join);
        assert!(decoded.claims.attributes.is_none());
    }

    #[tokio::test]
    async fn token_endpoint_rejects_invalid_join_key() {
        let app = build_router(test_state(Some("expected"), None).await);

        let payload = serde_json::json!({
            "room": "dnd-table-1",
            "identity": "alice",
            "name": "Alice",
            "join_key": "wrong"
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
    async fn token_endpoint_rejects_disallowed_room() {
        let app = build_router(test_state(None, Some("room-a,room-b")).await);

        let payload = serde_json::json!({
            "room": "room-c",
            "identity": "alice",
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

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn token_endpoint_rejects_bad_request() {
        let app = build_router(test_state(None, None).await);

        let payload = serde_json::json!({
            "room": "",
            "identity": "alice",
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

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
