use reqwest::Client;

use crate::{config::AppConfig, invites::InviteStore, users::UserStore};

#[derive(Debug, Clone)]
pub(crate) struct AppState {
    pub(crate) http_client: Client,
    pub(crate) config: AppConfig,
    pub(crate) invite_store: InviteStore,
    pub(crate) user_store: UserStore,
}
