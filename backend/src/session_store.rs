use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::users::{auth_user_from_row, AuthUser, StoreError};

#[derive(Debug, Clone)]
pub(crate) struct SessionStore {
    pool: SqlitePool,
}

impl SessionStore {
    pub(crate) async fn initialize(pool: SqlitePool) -> Result<Self, StoreError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS auth_sessions (
                session_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&pool)
        .await?;

        Ok(Self { pool })
    }

    pub(crate) async fn create_session(
        &self,
        session_id: &str,
        user_id: i64,
        expires_at: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        sqlx::query(
            r#"
            INSERT INTO auth_sessions (session_id, user_id, expires_at)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                user_id = excluded.user_id,
                expires_at = excluded.expires_at
            "#,
        )
        .bind(session_id)
        .bind(user_id)
        .bind(expires_at.timestamp())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub(crate) async fn get_session_user(
        &self,
        session_id: &str,
    ) -> Result<Option<AuthUser>, StoreError> {
        let maybe_row = sqlx::query(
            r#"
            SELECT
                users.id,
                users.email,
                users.normalized_email,
                users.display_name,
                users.google_subject,
                users.platform_role,
                users.game_role,
                users.is_active
            FROM auth_sessions
            INNER JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.session_id = ?
              AND auth_sessions.expires_at > unixepoch()
            "#,
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        maybe_row.map(auth_user_from_row).transpose()
    }

    pub(crate) async fn delete_session(&self, session_id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM auth_sessions WHERE session_id = ?")
            .bind(session_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{fs::File, time::SystemTime};

    use chrono::Duration;

    use super::*;
    use crate::users::{build_bootstrap_users, UserPatch, UserStore};

    async fn stores() -> (UserStore, SessionStore, AuthUser) {
        let users = UserStore::connect("sqlite::memory:").await.unwrap();
        let sessions = SessionStore::initialize(users.sqlite_pool()).await.unwrap();
        let bootstrap =
            build_bootstrap_users(&[], &[], &["player@example.com".to_string()]).unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let user = users
            .authorize_google_user("player@example.com", "google-sub-1", Some("Alice"))
            .await
            .unwrap();
        (users, sessions, user)
    }

    #[tokio::test]
    async fn returns_active_session_until_expired_or_deleted() {
        let (_users, sessions, user) = stores().await;

        sessions
            .create_session("active-session", user.id, Utc::now() + Duration::hours(1))
            .await
            .unwrap();
        sessions
            .create_session(
                "expired-session",
                user.id,
                Utc::now() - Duration::seconds(1),
            )
            .await
            .unwrap();

        let session_user = sessions.get_session_user("active-session").await.unwrap();
        assert_eq!(session_user.as_ref().map(|value| value.id), Some(user.id));
        assert!(sessions
            .get_session_user("expired-session")
            .await
            .unwrap()
            .is_none());

        sessions.delete_session("active-session").await.unwrap();
        assert!(sessions
            .get_session_user("active-session")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn preserves_inactive_user_state_for_auth_policy_filtering() {
        let (users, sessions, user) = stores().await;
        sessions
            .create_session("inactive-user", user.id, Utc::now() + Duration::hours(1))
            .await
            .unwrap();
        users
            .update_user(
                user.id,
                UserPatch {
                    is_active: Some(false),
                    ..UserPatch::default()
                },
            )
            .await
            .unwrap();

        let session_user = sessions
            .get_session_user("inactive-user")
            .await
            .unwrap()
            .unwrap();
        assert!(!session_user.is_active);
    }

    #[tokio::test]
    async fn session_persists_across_reconnect() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "fliesentisch-session-store-{}-{unique}.sqlite",
            std::process::id()
        ));
        File::create(&path).unwrap();
        let database_url = format!("sqlite://{}", path.display());

        let users = UserStore::connect(&database_url).await.unwrap();
        let sessions = SessionStore::initialize(users.sqlite_pool()).await.unwrap();
        let bootstrap =
            build_bootstrap_users(&[], &[], &["player@example.com".to_string()]).unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let user = users
            .authorize_google_user("player@example.com", "google-sub-1", None)
            .await
            .unwrap();
        sessions
            .create_session(
                "persisted-session",
                user.id,
                Utc::now() + Duration::hours(1),
            )
            .await
            .unwrap();
        users.sqlite_pool().close().await;

        let reopened_users = UserStore::connect(&database_url).await.unwrap();
        let reopened_sessions = SessionStore::initialize(reopened_users.sqlite_pool())
            .await
            .unwrap();
        let session_user = reopened_sessions
            .get_session_user("persisted-session")
            .await
            .unwrap();
        assert_eq!(session_user.as_ref().map(|value| value.id), Some(user.id));

        reopened_users.sqlite_pool().close().await;
        std::fs::remove_file(path).unwrap();
    }
}
