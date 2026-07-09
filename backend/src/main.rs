mod admin;
mod auth;
mod campaigns;
mod config;
mod error;
mod invites;
mod router;
mod session;
mod state;
mod token;
mod users;

use std::{net::SocketAddr, sync::Arc, time::Duration as StdDuration};

use reqwest::Client;
use tracing::{error, info};

use config::AppConfig;
use invites::InviteStore;
use router::build_router;
use state::AppState;
use users::UserStore;

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

    let invite_store = match InviteStore::initialize(user_store.sqlite_pool()).await {
        Ok(store) => store,
        Err(err) => {
            error!("invite store init error: {err}");
            std::process::exit(1);
        }
    };

    let bind_addr: SocketAddr = config
        .bind_addr
        .parse()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 8787)));

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
        invite_store,
        user_store,
    });
    let app = build_router(state);

    info!("auth service listening on {bind_addr}");
    let listener = match tokio::net::TcpListener::bind(bind_addr).await {
        Ok(listener) => listener,
        Err(err) => {
            error!("failed to bind auth listener: {err}");
            std::process::exit(1);
        }
    };
    if let Err(err) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    {
        error!("auth server failed: {err}");
        std::process::exit(1);
    }
}
