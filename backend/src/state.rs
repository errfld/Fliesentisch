use reqwest::Client;

use crate::{config::AppConfig, users::UserStore};

#[derive(Debug, Clone)]
pub(crate) struct AppState {
    pub(crate) http_client: Client,
    pub(crate) config: AppConfig,
    pub(crate) user_store: UserStore,
}
