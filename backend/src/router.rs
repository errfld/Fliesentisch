use std::sync::Arc;

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
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::error;

use crate::{
    admin::{create_admin_user, delete_admin_user, list_admin_users, update_admin_user},
    auth::{dev_login, handle_google_callback, start_google_login},
    error::ApiError,
    session::{get_session, logout},
    state::AppState,
    token::mint_token,
};

pub(crate) fn build_router(state: Arc<AppState>) -> Router {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        admin::AdminUsersResponse,
        auth::{random_token, signed_value, SESSION_COOKIE_NAME},
        config::{parse_optional_set, AppConfig},
        token::{derive_room_identity, LiveKitClaims, TokenResponse},
        users::{build_bootstrap_users, UserStore},
    };
    use axum::{body::Body, http::Request, http::StatusCode};
    use chrono::{Duration, Utc};
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
    use reqwest::Client;
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
