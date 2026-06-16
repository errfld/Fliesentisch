use std::{collections::HashSet, env};

use thiserror::Error;
use url::Url;

use crate::users::{build_bootstrap_users, BootstrapUser, StoreError};

const GOOGLE_CALLBACK_PATH: &str = "/api/v1/auth/google/callback";

#[derive(Debug, Clone)]
pub(crate) struct AppConfig {
    pub(crate) bind_addr: String,
    pub(crate) database_url: String,
    pub(crate) bootstrap_users: Vec<BootstrapUser>,
    pub(crate) livekit_api_key: String,
    pub(crate) livekit_api_secret: String,
    pub(crate) google_client_id: String,
    pub(crate) google_client_secret: String,
    pub(crate) google_redirect_uri: String,
    pub(crate) auth_base_url: Url,
    pub(crate) cookie_secret: String,
    pub(crate) allowed_rooms: Option<HashSet<String>>,
    pub(crate) token_ttl_seconds: u64,
    pub(crate) session_ttl_seconds: u64,
    pub(crate) frontend_origins: Vec<String>,
    pub(crate) secure_cookies: bool,
    pub(crate) enable_dev_login: bool,
}

impl AppConfig {
    pub(crate) fn from_env() -> Result<Self, ConfigError> {
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
        let token_ttl_seconds = parse_ttl_seconds("TOKEN_TTL_SECONDS", 3600)?;
        let session_ttl_seconds = parse_ttl_seconds("AUTH_SESSION_TTL_SECONDS", 60 * 60 * 24 * 14)?;
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
            .map(|value| parse_bool_flag(&value))
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

    pub(crate) fn absolute_frontend_path(&self, path: &str) -> String {
        if let Ok(url) = self.auth_base_url.join(path.trim_start_matches('/')) {
            url.to_string()
        } else {
            self.auth_base_url.to_string()
        }
    }
}

#[derive(Debug, Error)]
pub(crate) enum ConfigError {
    #[error("missing required env var: {0}")]
    MissingEnv(&'static str),
    #[error("required env var must not be empty: {0}")]
    EmptyEnv(&'static str),
    #[error("invalid bootstrap user config: {0}")]
    InvalidBootstrapUsers(String),
    #[error("invalid url: {0}")]
    InvalidUrl(String),
    #[error("invalid env var {key}: {value}")]
    InvalidEnv { key: &'static str, value: String },
}

fn read_required(key: &'static str) -> Result<String, ConfigError> {
    let value = env::var(key).map_err(|_| ConfigError::MissingEnv(key))?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ConfigError::EmptyEnv(key));
    }
    Ok(trimmed.to_string())
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

pub(crate) fn parse_optional_set(input: Option<String>) -> Option<HashSet<String>> {
    let values = parse_csv(input);
    if values.is_empty() {
        None
    } else {
        Some(values.into_iter().collect())
    }
}

fn parse_url(value: String) -> Result<Url, ConfigError> {
    let url = Url::parse(&value).map_err(|err| ConfigError::InvalidUrl(err.to_string()))?;
    if url.host_str().is_none() {
        return Err(ConfigError::InvalidUrl(format!(
            "missing host in url: {value}"
        )));
    }
    Ok(url)
}

fn parse_ttl_seconds(key: &'static str, default_seconds: u64) -> Result<u64, ConfigError> {
    match read_optional(key) {
        Some(value) => value.parse::<u64>().map_err(|err| ConfigError::InvalidEnv {
            key,
            value: format!("expected positive integer seconds, got '{value}': {err}"),
        }),
        None => Ok(default_seconds),
    }
}

fn parse_bool_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_optional_set_ignores_empty_entries() {
        let values = parse_optional_set(Some(" dnd-table-1, ,dnd-table-2 ".to_string()))
            .expect("non-empty set");

        assert_eq!(values.len(), 2);
        assert!(values.contains("dnd-table-1"));
        assert!(values.contains("dnd-table-2"));
    }

    #[test]
    fn parse_url_requires_host() {
        let err = parse_url("file:///tmp/auth".to_string()).expect_err("missing host rejected");

        assert!(matches!(err, ConfigError::InvalidUrl(_)));
    }

    #[test]
    fn origin_from_url_preserves_explicit_port() {
        let url = Url::parse("https://example.com:8443/some/path").expect("valid URL");

        assert_eq!(origin_from_url(&url), "https://example.com:8443");
    }

    #[test]
    fn parse_bool_flag_accepts_common_case_variants() {
        for value in ["1", "true", "True", "TRUE", "yes", "YES", "on", "On"] {
            assert!(parse_bool_flag(value), "{value} should be truthy");
        }

        for value in ["0", "false", "no", "off", ""] {
            assert!(!parse_bool_flag(value), "{value} should be falsey");
        }
    }
}
