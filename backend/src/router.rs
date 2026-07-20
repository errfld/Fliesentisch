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
    campaigns::{
        archive_campaign, create_campaign, list_available_campaigns, list_campaign_directory,
        list_managed_campaigns, update_campaign,
    },
    error::ApiError,
    invites::{
        create_campaign_invite, inspect_campaign_invite, list_campaign_invites,
        redeem_campaign_invite, revoke_campaign_invite,
    },
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
        .route("/api/v1/campaigns", get(list_available_campaigns))
        .route(
            "/api/v1/campaigns/manage",
            get(list_managed_campaigns).post(create_campaign),
        )
        .route(
            "/api/v1/campaigns/manage/users",
            get(list_campaign_directory),
        )
        .route(
            "/api/v1/campaigns/manage/{campaign_id}",
            patch(update_campaign).delete(archive_campaign),
        )
        .route(
            "/api/v1/campaigns/manage/{campaign_id}/invites",
            get(list_campaign_invites).post(create_campaign_invite),
        )
        .route(
            "/api/v1/campaigns/manage/{campaign_id}/invites/{invite_id}",
            axum::routing::delete(revoke_campaign_invite),
        )
        .route("/api/v1/invites/{token}", get(inspect_campaign_invite))
        .route(
            "/api/v1/invites/{token}/redeem",
            post(redeem_campaign_invite),
        )
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
        campaign_store::{CampaignInput, CampaignPreset, CampaignStore},
        config::{parse_optional_set, AppConfig},
        invites::{CreateInviteInput, InviteStore},
        token::{derive_room_identity, LiveKitClaims, TokenResponse},
        users::{build_bootstrap_users, GameRole, PlatformRole, UserStore},
    };
    use axum::{body::Body, http::Request, http::StatusCode};
    use chrono::{Duration, Utc};
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
    use reqwest::Client;
    use tower::ServiceExt;
    use url::Url;

    async fn test_state() -> Arc<AppState> {
        let user_store = UserStore::connect("sqlite::memory:").await.unwrap();
        let campaign_store = CampaignStore::initialize(user_store.sqlite_pool())
            .await
            .unwrap();
        let invite_store = InviteStore::initialize(user_store.sqlite_pool())
            .await
            .unwrap();
        let bootstrap_users = build_bootstrap_users(
            &["gm@example.com".to_string()],
            &[
                "gm@example.com".to_string(),
                "other-gm@example.com".to_string(),
            ],
            &[
                "player@example.com".to_string(),
                "outsider@example.com".to_string(),
            ],
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
            campaign_store,
            invite_store,
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
            decoded.claims.attributes.get("game_role"),
            Some(&"player".to_string())
        );
        assert_eq!(
            decoded.claims.attributes.get("platform_role"),
            Some(&"user".to_string())
        );
        assert_eq!(parsed.platform_role, PlatformRole::User);
        assert_eq!(
            parsed.identity,
            derive_room_identity(&state.config.cookie_secret, "google-player").unwrap()
        );
        assert_ne!(parsed.identity, "google-player");
    }

    #[tokio::test]
    async fn lobby_token_uses_a_separate_livekit_room() {
        let state = test_state().await;
        let cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let app = build_router(state);
        let payload = serde_json::json!({
            "room": "dnd-table-1",
            "name": "Alice",
            "purpose": "LOBBY"
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
        assert_eq!(decoded.claims.video.room, "__vt_lobby__dnd-table-1");
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

    #[tokio::test]
    async fn campaign_crud_scopes_room_tokens_to_members() {
        let state = test_state().await;
        let admin_cookie = session_cookie_for(&state, "gm@example.com", "google-gm").await;
        let player_cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let outsider_cookie =
            session_cookie_for(&state, "outsider@example.com", "google-outsider").await;
        let gm = state
            .user_store
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let player = state
            .user_store
            .find_user_by_email("player@example.com")
            .await
            .unwrap()
            .unwrap();
        let app = build_router(state);
        let create_payload = serde_json::json!({
            "display_name": "Thursday Night",
            "room_slug": "Thursday-Night",
            "gamemaster_user_ids": [gm.id],
            "player_user_ids": [player.id],
            "default_split_room_names": ["Library"]
        });
        let create_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/campaigns/manage")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", &admin_cookie)
                    .body(Body::from(create_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create_response.status(), StatusCode::CREATED);
        let body = axum::body::to_bytes(create_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let campaign: CampaignPreset = serde_json::from_slice(&body).unwrap();
        assert_eq!(campaign.room_slug, "thursday-night");

        let token_payload = serde_json::json!({ "room": "Thursday-Night", "name": "Alice" });
        let member_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", &player_cookie)
                    .body(Body::from(token_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(member_response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(member_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let token: TokenResponse = serde_json::from_slice(&body).unwrap();
        let decoded = decode::<LiveKitClaims>(
            &token.token,
            &DecodingKey::from_secret("devsecret".as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .unwrap();
        assert_eq!(decoded.claims.video.room, "thursday-night");

        let outsider_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", outsider_cookie)
                    .body(Body::from(token_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(outsider_response.status(), StatusCode::FORBIDDEN);

        let archive_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/campaigns/manage/{}", campaign.id))
                    .method("DELETE")
                    .header("cookie", admin_cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(archive_response.status(), StatusCode::NO_CONTENT);

        let archived_room_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", player_cookie)
                    .body(Body::from(token_payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(archived_room_response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn campaign_seat_role_overrides_global_game_role() {
        let state = test_state().await;
        let admin_cookie = session_cookie_for(&state, "gm@example.com", "google-gm").await;
        let global_gm_cookie =
            session_cookie_for(&state, "other-gm@example.com", "google-other-gm").await;
        let global_player_cookie =
            session_cookie_for(&state, "player@example.com", "google-player").await;
        let global_gm = state
            .user_store
            .find_user_by_email("other-gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let global_player = state
            .user_store
            .find_user_by_email("player@example.com")
            .await
            .unwrap()
            .unwrap();
        let app = build_router(state);
        let payload = serde_json::json!({
            "display_name": "Role Test",
            "room_slug": "role-test",
            "gamemaster_user_ids": [global_player.id],
            "player_user_ids": [global_gm.id]
        });
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/campaigns/manage")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", admin_cookie)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);

        for (cookie, expected_role) in [
            (global_gm_cookie, crate::users::GameRole::Player),
            (global_player_cookie, crate::users::GameRole::Gamemaster),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/v1/token")
                        .method("POST")
                        .header("content-type", "application/json")
                        .header("cookie", cookie)
                        .body(Body::from(
                            serde_json::json!({ "room": "role-test", "name": "Seat" }).to_string(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let token: TokenResponse = serde_json::from_slice(&body).unwrap();
            assert_eq!(token.game_role, expected_role);
            let decoded = decode::<LiveKitClaims>(
                &token.token,
                &DecodingKey::from_secret("devsecret".as_bytes()),
                &Validation::new(Algorithm::HS256),
            )
            .unwrap();
            assert_eq!(
                decoded.claims.attributes.get("game_role"),
                Some(&expected_role.as_str().to_string())
            );
        }
    }

    #[tokio::test]
    async fn players_cannot_manage_campaigns_and_invalid_members_are_rejected() {
        let state = test_state().await;
        let player_cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let admin_cookie = session_cookie_for(&state, "gm@example.com", "google-gm").await;
        let app = build_router(state);
        let payload = serde_json::json!({
            "display_name": "Nope",
            "room_slug": "nope",
            "gamemaster_user_ids": [999999]
        });

        let player_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/campaigns/manage")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", player_cookie)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(player_response.status(), StatusCode::FORBIDDEN);

        let invalid_member_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/campaigns/manage")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", admin_cookie)
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_member_response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn campaign_invites_are_visible_only_to_their_gamemasters_and_admins() {
        let state = test_state().await;
        let admin = state
            .user_store
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let campaign = state
            .campaign_store
            .create_campaign(
                admin.id,
                CampaignInput {
                    display_name: "Private Invite Ledger".to_string(),
                    room_slug: "private-invite-ledger".to_string(),
                    gamemaster_user_ids: vec![admin.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        state
            .invite_store
            .create_invite(
                campaign.id,
                admin.id,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: None,
                },
                "private-ledger-token",
            )
            .await
            .unwrap();
        let admin_cookie = session_cookie_for(&state, "gm@example.com", "google-gm").await;
        let unrelated_gm_cookie =
            session_cookie_for(&state, "other-gm@example.com", "google-other-gm").await;
        let player_cookie = session_cookie_for(&state, "player@example.com", "google-player").await;
        let app = build_router(state);
        let uri = format!("/api/v1/campaigns/manage/{}/invites", campaign.id);

        for (cookie, expected) in [
            (admin_cookie, StatusCode::OK),
            (unrelated_gm_cookie, StatusCode::FORBIDDEN),
            (player_cookie, StatusCode::FORBIDDEN),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(&uri)
                        .header("cookie", cookie)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }

    #[tokio::test]
    async fn invite_dev_login_provisions_only_campaign_player_access() {
        let state = test_state().await;
        let gm = state
            .user_store
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let campaign = state
            .campaign_store
            .create_campaign(
                gm.id,
                CampaignInput {
                    display_name: "Invite Table".to_string(),
                    room_slug: "invite-table".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        state
            .invite_store
            .create_invite(
                campaign.id,
                gm.id,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: Some(1),
                },
                "guest-secret",
            )
            .await
            .unwrap();
        let app = build_router(state.clone());

        let login = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/auth/dev-login?email=guest%40example.com&name=Guest&next=%2Finvite%2Fguest-secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(login.status(), StatusCode::SEE_OTHER);
        let cookie = login
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let guest = state
            .user_store
            .find_user_by_email("guest@example.com")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(guest.platform_role, PlatformRole::User);
        assert_eq!(guest.game_role, GameRole::Player);
        assert_eq!(
            state
                .campaign_store
                .campaign_role_for_user(campaign.id, guest.id)
                .await
                .unwrap(),
            Some(GameRole::Player)
        );

        let legacy_room = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", &cookie)
                    .body(Body::from(
                        serde_json::json!({ "room": "dnd-table-1", "name": "Guest" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(legacy_room.status(), StatusCode::FORBIDDEN);

        let invited_room = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/token")
                    .method("POST")
                    .header("content-type", "application/json")
                    .header("cookie", cookie)
                    .body(Body::from(
                        serde_json::json!({ "room": "invite-table", "name": "Guest" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invited_room.status(), StatusCode::OK);
    }
}
