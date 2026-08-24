use reqwest::{Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use url::Url;

use crate::config::AppConfig;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

#[derive(Clone)]
pub(crate) struct GoogleOAuthClient {
    http: Client,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    endpoints: GoogleEndpoints,
}

impl std::fmt::Debug for GoogleOAuthClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GoogleOAuthClient")
            .field("client_id", &self.client_id)
            .field("client_secret", &"[redacted]")
            .field("redirect_uri", &self.redirect_uri)
            .field("endpoints", &self.endpoints)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
struct GoogleEndpoints {
    authorization: String,
    token: String,
    userinfo: String,
}

impl Default for GoogleEndpoints {
    fn default() -> Self {
        Self {
            authorization: GOOGLE_AUTH_URL.to_string(),
            token: GOOGLE_TOKEN_URL.to_string(),
            userinfo: GOOGLE_USERINFO_URL.to_string(),
        }
    }
}

impl GoogleOAuthClient {
    pub(crate) fn new(http: Client, config: &AppConfig) -> Self {
        Self {
            http,
            client_id: config.google_client_id.clone(),
            client_secret: config.google_client_secret.clone(),
            redirect_uri: config.google_redirect_uri.clone(),
            endpoints: GoogleEndpoints::default(),
        }
    }

    pub(crate) fn authorization_url(
        &self,
        state: &str,
        pkce_challenge: &str,
    ) -> Result<Url, GoogleOAuthError> {
        let mut url = Url::parse(&self.endpoints.authorization)
            .map_err(|source| GoogleOAuthError::InvalidAuthorizationEndpoint { source })?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &self.redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid email profile")
            .append_pair("state", state)
            .append_pair("code_challenge", pkce_challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("prompt", "select_account");
        Ok(url)
    }

    pub(crate) async fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> Result<GoogleProfile, GoogleOAuthError> {
        let token_response = self
            .http
            .post(&self.endpoints.token)
            .form(&[
                ("code", code),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
                ("code_verifier", code_verifier),
            ])
            .send()
            .await
            .map_err(|source| GoogleOAuthError::Transport {
                operation: "token exchange",
                source,
            })?;

        ensure_success("token exchange", token_response.status())?;
        let token: GoogleTokenResponse =
            token_response
                .json()
                .await
                .map_err(|source| GoogleOAuthError::Decode {
                    operation: "token exchange",
                    source,
                })?;

        let userinfo_response = self
            .http
            .get(&self.endpoints.userinfo)
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|source| GoogleOAuthError::Transport {
                operation: "userinfo request",
                source,
            })?;

        ensure_success("userinfo request", userinfo_response.status())?;
        userinfo_response
            .json()
            .await
            .map_err(|source| GoogleOAuthError::Decode {
                operation: "userinfo request",
                source,
            })
    }

    #[cfg(test)]
    fn with_endpoints(mut self, authorization: String, token: String, userinfo: String) -> Self {
        self.endpoints = GoogleEndpoints {
            authorization,
            token,
            userinfo,
        };
        self
    }
}

fn ensure_success(operation: &'static str, status: StatusCode) -> Result<(), GoogleOAuthError> {
    if status.is_success() {
        Ok(())
    } else {
        Err(GoogleOAuthError::ProviderStatus { operation, status })
    }
}

#[derive(Debug, Error)]
pub(crate) enum GoogleOAuthError {
    #[error("invalid Google authorization endpoint")]
    InvalidAuthorizationEndpoint {
        #[source]
        source: url::ParseError,
    },
    #[error("Google {operation} transport failed")]
    Transport {
        operation: &'static str,
        #[source]
        source: reqwest::Error,
    },
    #[error("Google {operation} returned HTTP {status}")]
    ProviderStatus {
        operation: &'static str,
        status: StatusCode,
    },
    #[error("Google {operation} response could not be decoded")]
    Decode {
        operation: &'static str,
        #[source]
        source: reqwest::Error,
    },
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GoogleProfile {
    pub(crate) sub: String,
    pub(crate) email: String,
    #[serde(default)]
    pub(crate) email_verified: bool,
    pub(crate) name: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        body::Bytes,
        extract::State,
        http::{HeaderMap, StatusCode as AxumStatusCode},
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };
    use serde_json::json;

    use super::*;

    fn config() -> AppConfig {
        AppConfig {
            bind_addr: "127.0.0.1:8787".to_string(),
            database_url: "sqlite::memory:".to_string(),
            bootstrap_users: vec![],
            livekit_api_key: "devkey".to_string(),
            livekit_api_secret: "devsecret".to_string(),
            google_client_id: "google-client".to_string(),
            google_client_secret: "google-secret".to_string(),
            google_redirect_uri: "http://localhost/callback".to_string(),
            auth_base_url: Url::parse("http://localhost:3000/").unwrap(),
            cookie_secret: "cookie-secret".to_string(),
            allowed_rooms: None,
            token_ttl_seconds: 3600,
            session_ttl_seconds: 7200,
            frontend_origins: vec![],
            secure_cookies: false,
            enable_dev_login: false,
        }
    }

    #[test]
    fn authorization_url_contains_oauth_and_pkce_parameters() {
        let client = GoogleOAuthClient::new(Client::new(), &config());
        let url = client
            .authorization_url("state-token", "pkce-challenge")
            .unwrap();
        let pairs = url.query_pairs().into_owned().collect::<Vec<_>>();

        for expected in [
            ("client_id", "google-client"),
            ("redirect_uri", "http://localhost/callback"),
            ("response_type", "code"),
            ("scope", "openid email profile"),
            ("state", "state-token"),
            ("code_challenge", "pkce-challenge"),
            ("code_challenge_method", "S256"),
            ("prompt", "select_account"),
        ] {
            assert!(pairs
                .iter()
                .any(|pair| pair.0 == expected.0 && pair.1 == expected.1));
        }
    }

    #[test]
    fn debug_output_redacts_client_secret() {
        let client = GoogleOAuthClient::new(Client::new(), &config());
        let debug = format!("{client:?}");

        assert!(!debug.contains("google-secret"));
        assert!(debug.contains("[redacted]"));
    }

    #[tokio::test]
    async fn exchange_sends_expected_form_and_bearer_token() {
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let app = Router::new()
            .route(
                "/token",
                post(
                    |State(requests): State<Arc<Mutex<Vec<String>>>>, body: Bytes| async move {
                        requests
                            .lock()
                            .unwrap()
                            .push(String::from_utf8(body.to_vec()).unwrap());
                        Json(json!({"access_token": "provider-token"}))
                    },
                ),
            )
            .route(
                "/userinfo",
                get(
                    |State(requests): State<Arc<Mutex<Vec<String>>>>,
                     headers: HeaderMap| async move {
                        requests.lock().unwrap().push(
                            headers
                                .get("authorization")
                                .unwrap()
                                .to_str()
                                .unwrap()
                                .to_string(),
                        );
                        Json(json!({
                            "sub": "google-subject",
                            "email": "alice@example.com",
                            "email_verified": false,
                            "name": "Alice"
                        }))
                    },
                ),
            )
            .with_state(requests.clone());
        let (base_url, task) = spawn_server(app).await;
        let client = GoogleOAuthClient::new(Client::new(), &config()).with_endpoints(
            format!("{base_url}/authorize"),
            format!("{base_url}/token"),
            format!("{base_url}/userinfo"),
        );

        let profile = client.exchange_code("auth-code", "verifier").await.unwrap();
        task.abort();

        assert_eq!(profile.sub, "google-subject");
        assert_eq!(profile.email, "alice@example.com");
        assert!(!profile.email_verified);
        assert_eq!(profile.name.as_deref(), Some("Alice"));
        let requests = requests.lock().unwrap();
        let form = url::form_urlencoded::parse(requests[0].as_bytes())
            .into_owned()
            .collect::<Vec<_>>();
        for expected in [
            ("code", "auth-code"),
            ("client_id", "google-client"),
            ("client_secret", "google-secret"),
            ("redirect_uri", "http://localhost/callback"),
            ("grant_type", "authorization_code"),
            ("code_verifier", "verifier"),
        ] {
            assert!(form
                .iter()
                .any(|pair| pair.0 == expected.0 && pair.1 == expected.1));
        }
        assert_eq!(requests[1], "Bearer provider-token");
    }

    #[tokio::test]
    async fn exchange_reports_non_success_and_malformed_json() {
        let status_app = Router::new().route(
            "/token",
            post(|| async { (AxumStatusCode::BAD_GATEWAY, "upstream unavailable") }),
        );
        let (base_url, status_task) = spawn_server(status_app).await;
        let status_client = GoogleOAuthClient::new(Client::new(), &config()).with_endpoints(
            format!("{base_url}/authorize"),
            format!("{base_url}/token"),
            format!("{base_url}/userinfo"),
        );
        assert!(matches!(
            status_client.exchange_code("code", "verifier").await,
            Err(GoogleOAuthError::ProviderStatus {
                operation: "token exchange",
                ..
            })
        ));
        status_task.abort();

        let malformed_app = Router::new().route(
            "/token",
            post(|| async { (AxumStatusCode::OK, "not-json").into_response() }),
        );
        let (base_url, malformed_task) = spawn_server(malformed_app).await;
        let malformed_client = GoogleOAuthClient::new(Client::new(), &config()).with_endpoints(
            format!("{base_url}/authorize"),
            format!("{base_url}/token"),
            format!("{base_url}/userinfo"),
        );
        assert!(matches!(
            malformed_client.exchange_code("code", "verifier").await,
            Err(GoogleOAuthError::Decode {
                operation: "token exchange",
                ..
            })
        ));
        malformed_task.abort();
    }

    #[tokio::test]
    async fn exchange_validates_userinfo_status_and_json() {
        let status_app = Router::new()
            .route(
                "/token",
                post(|| async { Json(json!({"access_token": "provider-token"})) }),
            )
            .route(
                "/userinfo",
                get(|| async { (AxumStatusCode::UNAUTHORIZED, "expired token") }),
            );
        let (base_url, status_task) = spawn_server(status_app).await;
        let status_client = GoogleOAuthClient::new(Client::new(), &config()).with_endpoints(
            format!("{base_url}/authorize"),
            format!("{base_url}/token"),
            format!("{base_url}/userinfo"),
        );
        assert!(matches!(
            status_client.exchange_code("code", "verifier").await,
            Err(GoogleOAuthError::ProviderStatus {
                operation: "userinfo request",
                ..
            })
        ));
        status_task.abort();

        let malformed_app = Router::new()
            .route(
                "/token",
                post(|| async { Json(json!({"access_token": "provider-token"})) }),
            )
            .route(
                "/userinfo",
                get(|| async { (AxumStatusCode::OK, "not-json").into_response() }),
            );
        let (base_url, malformed_task) = spawn_server(malformed_app).await;
        let malformed_client = GoogleOAuthClient::new(Client::new(), &config()).with_endpoints(
            format!("{base_url}/authorize"),
            format!("{base_url}/token"),
            format!("{base_url}/userinfo"),
        );
        assert!(matches!(
            malformed_client.exchange_code("code", "verifier").await,
            Err(GoogleOAuthError::Decode {
                operation: "userinfo request",
                ..
            })
        ));
        malformed_task.abort();
    }

    #[tokio::test]
    async fn exchange_treats_missing_email_verification_as_unverified() {
        let app = Router::new()
            .route(
                "/token",
                post(|| async { Json(json!({"access_token": "provider-token"})) }),
            )
            .route(
                "/userinfo",
                get(|| async {
                    Json(json!({
                        "sub": "google-subject",
                        "email": "alice@example.com"
                    }))
                }),
            );
        let (base_url, task) = spawn_server(app).await;
        let client = GoogleOAuthClient::new(Client::new(), &config()).with_endpoints(
            format!("{base_url}/authorize"),
            format!("{base_url}/token"),
            format!("{base_url}/userinfo"),
        );

        let profile = client.exchange_code("code", "verifier").await.unwrap();
        task.abort();

        assert!(!profile.email_verified);
    }

    async fn spawn_server(app: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), task)
    }
}
