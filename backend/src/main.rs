mod users;

use axum::{
    extract::{Path, Query, State},
    http::{
        header::{ACCEPT, CONTENT_TYPE},
        HeaderValue, Method, StatusCode,
    },
    response::{IntoResponse, Redirect, Response},
    routing::{get, patch, post},
    Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use rand::{rngs::OsRng, RngCore};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, env, net::SocketAddr, sync::Arc};
use thiserror::Error;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{error, info};
use url::Url;
use users::{
    build_bootstrap_users, AuthUser, BootstrapUser, GameRole, NewUser, PlatformRole, StoreError,
    UserPatch, UserStore,
};

const SESSION_COOKIE_NAME: &str = "vt_session";
const OAUTH_STATE_COOKIE_NAME: &str = "vt_oauth_state";
const OAUTH_VERIFIER_COOKIE_NAME: &str = "vt_oauth_verifier";
const OAUTH_NEXT_COOKIE_NAME: &str = "vt_oauth_next";
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALLBACK_PATH: &str = "/api/v1/auth/google/callback";
const UNAUTHORIZED_PATH: &str = "/auth/unauthorized";
const DEFAULT_AUTH_REDIRECT: &str = "/";
const MAX_DISPLAY_NAME_LENGTH: usize = 48;

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

    let state = Arc::new(AppState {
        http_client: Client::new(),
        config,
        user_store,
    });
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
            .allow_origin(Any)
            .allow_credentials(true);
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

async fn get_session(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> Result<impl IntoResponse, ApiError> {
    let user = get_authenticated_user(&state, &jar).await?;

    Ok(Json(AuthSessionResponse {
        authenticated: user.is_some(),
        user: user.map(SessionUser::from),
    }))
}

async fn start_google_login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Query(params): Query<LoginQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let state_token = random_token(24);
    let pkce_verifier = random_token(32);
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

async fn handle_google_callback(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Query(params): Query<GoogleCallbackQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let next = read_signed_cookie(&state.config, &jar, OAUTH_NEXT_COOKIE_NAME)
        .unwrap_or_else(|| DEFAULT_AUTH_REDIRECT.to_string());
    let expected_state = read_signed_cookie(&state.config, &jar, OAUTH_STATE_COOKIE_NAME);
    let pkce_verifier = read_signed_cookie(&state.config, &jar, OAUTH_VERIFIER_COOKIE_NAME);
    let clear_jar = clear_oauth_cookies(&state.config, jar);

    if let Some(error_code) = params.error.as_deref() {
        return Ok((
            clear_jar,
            Redirect::to(&unauthorized_redirect(
                &state.config,
                "google_denied",
                Some(error_code),
            )),
        ));
    }

    let Some(code) = params.code.as_deref() else {
        return Ok((
            clear_jar,
            Redirect::to(&unauthorized_redirect(
                &state.config,
                "missing_code",
                params.error_description.as_deref(),
            )),
        ));
    };

    let Some(expected_state) = expected_state else {
        return Ok((
            clear_jar,
            Redirect::to(&unauthorized_redirect(&state.config, "missing_state", None)),
        ));
    };
    let Some(pkce_verifier) = pkce_verifier else {
        return Ok((
            clear_jar,
            Redirect::to(&unauthorized_redirect(
                &state.config,
                "missing_verifier",
                None,
            )),
        ));
    };

    if params.state.as_deref() != Some(expected_state.as_str()) {
        return Ok((
            clear_jar,
            Redirect::to(&unauthorized_redirect(
                &state.config,
                "state_mismatch",
                None,
            )),
        ));
    }

    let google_user = match exchange_google_code(&state, code, &pkce_verifier).await {
        Ok(user) => user,
        Err(err) => {
            error!("google oauth exchange error: {err}");
            return Ok((
                clear_jar,
                Redirect::to(&unauthorized_redirect(
                    &state.config,
                    "oauth_exchange_failed",
                    Some("Unable to complete Google sign-in."),
                )),
            ));
        }
    };

    if !google_user.email_verified {
        return Ok((
            clear_jar,
            Redirect::to(&unauthorized_redirect(
                &state.config,
                "email_not_verified",
                Some("Google account email must be verified."),
            )),
        ));
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
        Err(StoreError::UnknownUser(_)) | Err(StoreError::InactiveUser(_)) => {
            return Ok((
                clear_jar,
                Redirect::to(&unauthorized_redirect(
                    &state.config,
                    "access_denied",
                    Some("Your Google account is not authorized for this table."),
                )),
            ));
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

async fn logout(
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

async fn dev_login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Query(params): Query<DevLoginQuery>,
) -> Result<impl IntoResponse, ApiError> {
    if !state.config.enable_dev_login {
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

async fn list_admin_users(
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

async fn create_admin_user(
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

async fn update_admin_user(
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

async fn delete_admin_user(
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

    let user = require_authenticated(&state, &jar).await?;
    let google_subject = user.google_subject.clone().ok_or_else(|| {
        ApiError::Forbidden("authenticated user is missing Google identity".to_string())
    })?;
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
    let expiry = now + Duration::seconds(state.config.token_ttl_seconds as i64);

    let claims = LiveKitClaims {
        iss: state.config.livekit_api_key.clone(),
        sub: google_subject,
        name: updated_user
            .display_name
            .unwrap_or_else(|| nickname.to_string()),
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
            token,
            expires_at: expiry,
            identity: claims.sub,
            game_role: updated_user.game_role,
        }),
    ))
}

async fn get_authenticated_user(
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

async fn require_authenticated(state: &AppState, jar: &CookieJar) -> Result<AuthUser, ApiError> {
    get_authenticated_user(state, jar)
        .await?
        .ok_or(ApiError::Unauthenticated)
}

async fn require_admin(state: &AppState, jar: &CookieJar) -> Result<AuthUser, ApiError> {
    let user = require_authenticated(state, jar).await?;
    if user.platform_role != PlatformRole::Admin {
        return Err(ApiError::Forbidden(
            "admin access is required for this operation".to_string(),
        ));
    }

    Ok(user)
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
        .map_err(|_| ApiError::Internal)?;

    if !token_response.status().is_success() {
        return Err(ApiError::Internal);
    }

    let token_body: GoogleTokenResponse = token_response
        .json()
        .await
        .map_err(|_| ApiError::Internal)?;

    let userinfo_response = state
        .http_client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(token_body.access_token)
        .send()
        .await
        .map_err(|_| ApiError::Internal)?;

    if !userinfo_response.status().is_success() {
        return Err(ApiError::Internal);
    }

    userinfo_response
        .json()
        .await
        .map_err(|_| ApiError::Internal)
}

async fn create_session_cookie(
    state: &AppState,
    jar: CookieJar,
    user: &AuthUser,
) -> Result<CookieJar, ApiError> {
    let session_id = random_token(32);
    let expires_at = Utc::now() + Duration::seconds(state.config.session_ttl_seconds as i64);
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

fn store_to_api_error(err: StoreError) -> ApiError {
    match err {
        StoreError::UserNotFound(_) => ApiError::NotFound("user not found".to_string()),
        StoreError::InvalidEmail(message) => ApiError::BadRequest(message),
        StoreError::EmailAlreadyExists(message) => ApiError::Conflict(message),
        StoreError::LastAdminRemoval => ApiError::Conflict(err.to_string()),
        StoreError::UnknownUser(_) => ApiError::Forbidden(err.to_string()),
        StoreError::InactiveUser(_) => ApiError::Forbidden(err.to_string()),
        other => {
            error!("store error: {other}");
            ApiError::Internal
        }
    }
}

fn set_cookie(
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

fn remove_cookie(config: &AppConfig, jar: CookieJar, name: &str) -> CookieJar {
    jar.remove(
        Cookie::build((name.to_string(), String::new()))
            .path("/")
            .http_only(true)
            .same_site(SameSite::Lax)
            .secure(config.secure_cookies)
            .build(),
    )
}

fn clear_oauth_cookies(config: &AppConfig, jar: CookieJar) -> CookieJar {
    let jar = remove_cookie(config, jar, OAUTH_STATE_COOKIE_NAME);
    let jar = remove_cookie(config, jar, OAUTH_VERIFIER_COOKIE_NAME);
    remove_cookie(config, jar, OAUTH_NEXT_COOKIE_NAME)
}

fn read_signed_cookie(config: &AppConfig, jar: &CookieJar, name: &str) -> Option<String> {
    let value = jar.get(name)?.value().to_string();
    verify_signed_value(&config.cookie_secret, &value)
}

fn signed_value(secret: &str, value: &str) -> Result<String, ApiError> {
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

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn random_token(num_bytes: usize) -> String {
    let mut bytes = vec![0_u8; num_bytes];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
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

fn unauthorized_redirect(config: &AppConfig, reason: &str, detail: Option<&str>) -> String {
    let mut url = Url::parse(&config.absolute_frontend_path(UNAUTHORIZED_PATH))
        .expect("valid unauthorized redirect url");
    url.query_pairs_mut().append_pair("reason", reason);
    if let Some(detail) = detail {
        url.query_pairs_mut().append_pair("detail", detail);
    }
    url.to_string()
}

#[derive(Debug, Clone)]
struct AppState {
    http_client: Client,
    config: AppConfig,
    user_store: UserStore,
}

#[derive(Debug, Clone)]
struct AppConfig {
    bind_addr: String,
    database_url: String,
    bootstrap_users: Vec<BootstrapUser>,
    livekit_api_key: String,
    livekit_api_secret: String,
    google_client_id: String,
    google_client_secret: String,
    google_redirect_uri: String,
    auth_base_url: Url,
    cookie_secret: String,
    allowed_rooms: Option<HashSet<String>>,
    token_ttl_seconds: u64,
    session_ttl_seconds: u64,
    frontend_origins: Vec<String>,
    secure_cookies: bool,
    enable_dev_login: bool,
}

impl AppConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let livekit_api_key = read_required("LIVEKIT_API_KEY")?;
        let livekit_api_secret = read_required("LIVEKIT_API_SECRET")?;
        let google_client_id = read_required("GOOGLE_CLIENT_ID")?;
        let google_client_secret = read_required("GOOGLE_CLIENT_SECRET")?;
        let cookie_secret = read_required("AUTH_COOKIE_SECRET")?;
        let auth_base_url = parse_url(read_required("AUTH_BASE_URL")?)?;

        let bind_addr = env::var("AUTH_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
        let database_url = env::var("AUTH_DATABASE_URL")
            .unwrap_or_else(|_| "sqlite:///app/data/auth.db?mode=rwc".to_string());
        let bootstrap_users = build_bootstrap_users(
            &parse_csv(read_optional("AUTH_BOOTSTRAP_ADMIN_EMAILS")),
            &parse_csv(read_optional("AUTH_BOOTSTRAP_GAMEMASTER_EMAILS")),
            &parse_csv(read_optional("AUTH_BOOTSTRAP_PLAYER_EMAILS")),
        )?;
        let allowed_rooms = parse_optional_set(read_optional("ALLOWED_ROOMS"));
        let token_ttl_seconds = env::var("TOKEN_TTL_SECONDS")
            .ok()
            .and_then(|val| val.parse::<u64>().ok())
            .unwrap_or(3600);
        let session_ttl_seconds = env::var("AUTH_SESSION_TTL_SECONDS")
            .ok()
            .and_then(|val| val.parse::<u64>().ok())
            .unwrap_or(60 * 60 * 24 * 14);
        let frontend_origins = {
            let configured = parse_csv(read_optional("FRONTEND_ORIGINS"));
            if configured.is_empty() {
                vec![origin_from_url(&auth_base_url)]
            } else {
                configured
            }
        };
        let secure_cookies = auth_base_url.scheme() == "https";
        let enable_dev_login = env::var("AUTH_ENABLE_DEV_LOGIN")
            .ok()
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);
        let google_redirect_uri = auth_base_url
            .join(GOOGLE_CALLBACK_PATH.trim_start_matches('/'))
            .map_err(|value| ConfigError::InvalidUrl(value.to_string()))?
            .to_string();

        Ok(Self {
            bind_addr,
            database_url,
            bootstrap_users,
            livekit_api_key,
            livekit_api_secret,
            google_client_id,
            google_client_secret,
            google_redirect_uri,
            auth_base_url,
            cookie_secret,
            allowed_rooms,
            token_ttl_seconds,
            session_ttl_seconds,
            frontend_origins,
            secure_cookies,
            enable_dev_login,
        })
    }

    fn absolute_frontend_path(&self, path: &str) -> String {
        if let Ok(url) = self.auth_base_url.join(path.trim_start_matches('/')) {
            url.to_string()
        } else {
            self.auth_base_url.to_string()
        }
    }
}

#[derive(Debug, Error)]
enum ConfigError {
    #[error("missing required env var: {0}")]
    MissingEnv(&'static str),
    #[error("invalid bootstrap user config: {0}")]
    InvalidBootstrapUsers(String),
    #[error("invalid url: {0}")]
    InvalidUrl(String),
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

fn parse_url(value: String) -> Result<Url, ConfigError> {
    Url::parse(&value).map_err(|err| ConfigError::InvalidUrl(err.to_string()))
}

fn origin_from_url(url: &Url) -> String {
    match url.port() {
        Some(port) => format!(
            "{}://{}:{}",
            url.scheme(),
            url.host_str().unwrap_or("localhost"),
            port
        ),
        None => format!(
            "{}://{}",
            url.scheme(),
            url.host_str().unwrap_or("localhost")
        ),
    }
}

impl From<StoreError> for ConfigError {
    fn from(value: StoreError) -> Self {
        ConfigError::InvalidBootstrapUsers(value.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct LoginQuery {
    next: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleCallbackQuery {
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
struct TokenRequest {
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
struct TokenResponse {
    token: String,
    expires_at: DateTime<Utc>,
    identity: String,
    game_role: GameRole,
}

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

#[derive(Debug, Serialize, Deserialize)]
struct AdminUsersResponse {
    users: Vec<AdminUser>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AdminUser {
    id: i64,
    email: String,
    display_name: Option<String>,
    google_subject: Option<String>,
    platform_role: PlatformRole,
    game_role: GameRole,
    is_active: bool,
}

impl From<AuthUser> for AdminUser {
    fn from(user: AuthUser) -> Self {
        Self {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            google_subject: user.google_subject,
            platform_role: user.platform_role,
            game_role: user.game_role,
            is_active: user.is_active,
        }
    }
}

#[derive(Debug, Deserialize)]
struct CreateUserRequest {
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
struct UpdateUserRequest {
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

#[derive(Debug, Serialize, Deserialize)]
struct LiveKitClaims {
    iss: String,
    sub: String,
    name: String,
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

#[derive(Debug, Error)]
enum ApiError {
    #[error("not authenticated")]
    Unauthenticated,
    #[error("room is not allowed: {0}")]
    RoomNotAllowed(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    NotFound(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            ApiError::Unauthenticated => (
                StatusCode::UNAUTHORIZED,
                "UNAUTHENTICATED",
                "authentication required".to_string(),
            ),
            ApiError::RoomNotAllowed(_) => {
                (StatusCode::FORBIDDEN, "ROOM_NOT_ALLOWED", self.to_string())
            }
            ApiError::Forbidden(_) => (StatusCode::FORBIDDEN, "FORBIDDEN", self.to_string()),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT", self.to_string()),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND", self.to_string()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use jsonwebtoken::{decode, DecodingKey, Validation};
    use tower::ServiceExt;

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
        let session_id = random_token(16);
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
        let app = build_router(state);

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
    async fn token_endpoint_returns_jwt_when_authenticated() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let app = build_router(state);

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
        assert_eq!(decoded.claims.sub, "google-player");
        assert_eq!(parsed.identity, "google-player");
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
