use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::{collections::BTreeMap, path::Path};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct UserStore {
    pool: SqlitePool,
}

impl UserStore {
    pub async fn connect(database_url: &str) -> Result<Self, StoreError> {
        ensure_sqlite_parent_dir(database_url).await?;

        let max_connections = if database_url.starts_with("sqlite::memory:") {
            1
        } else {
            5
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .after_connect(|conn, _meta| {
                Box::pin(async move {
                    sqlx::query("PRAGMA foreign_keys = ON")
                        .execute(conn)
                        .await
                        .map(|_| ())
                })
            })
            .connect(database_url)
            .await?;

        let store = Self { pool };
        store.initialize().await?;

        Ok(store)
    }

    async fn initialize(&self) -> Result<(), StoreError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                normalized_email TEXT NOT NULL UNIQUE,
                display_name TEXT,
                google_subject TEXT UNIQUE,
                platform_role TEXT NOT NULL CHECK (platform_role IN ('admin', 'user')),
                game_role TEXT NOT NULL CHECK (game_role IN ('gamemaster', 'player')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

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
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn seed_bootstrap_users(&self, users: &[BootstrapUser]) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;

        for user in users {
            sqlx::query(
                r#"
                INSERT INTO users (
                    email,
                    normalized_email,
                    platform_role,
                    game_role,
                    is_active
                )
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(normalized_email) DO UPDATE SET
                    email = excluded.email,
                    is_active = 1,
                    platform_role = CASE
                        WHEN users.platform_role = 'admin' OR excluded.platform_role = 'admin' THEN 'admin'
                        ELSE users.platform_role
                    END,
                    game_role = CASE
                        WHEN users.game_role = 'gamemaster' OR excluded.game_role = 'gamemaster' THEN 'gamemaster'
                        ELSE users.game_role
                    END,
                    updated_at = CURRENT_TIMESTAMP
                "#,
            )
            .bind(&user.email)
            .bind(&user.normalized_email)
            .bind(user.platform_role.as_str())
            .bind(user.game_role.as_str())
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(())
    }

    pub async fn count_users(&self) -> Result<i64, StoreError> {
        let row = sqlx::query("SELECT COUNT(*) AS count FROM users")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get("count"))
    }

    pub async fn list_users(&self) -> Result<Vec<AuthUser>, StoreError> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                email,
                normalized_email,
                display_name,
                google_subject,
                platform_role,
                game_role,
                is_active
            FROM users
            ORDER BY normalized_email ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(auth_user_from_row).collect()
    }

    pub async fn authorize_google_user(
        &self,
        email: &str,
        google_subject: &str,
        display_name: Option<&str>,
    ) -> Result<AuthUser, StoreError> {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() {
            return Err(StoreError::UnknownUser(email.trim().to_string()));
        }

        let maybe_row = sqlx::query(
            r#"
            SELECT
                id,
                email,
                normalized_email,
                display_name,
                google_subject,
                platform_role,
                game_role,
                is_active
            FROM users
            WHERE normalized_email = ?
            "#,
        )
        .bind(&normalized_email)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = maybe_row else {
            return Err(StoreError::UnknownUser(normalized_email));
        };

        let current_subject = row.get::<Option<String>, _>("google_subject");
        if let Some(existing_subject) = current_subject.as_deref() {
            if existing_subject != google_subject {
                return Err(StoreError::GoogleSubjectMismatch(
                    normalized_email,
                    existing_subject.to_string(),
                ));
            }
        }

        if row.get::<i64, _>("is_active") == 0 {
            return Err(StoreError::InactiveUser(normalized_email));
        }

        let display_name = sanitize_optional_text(display_name);
        let canonical_email = email.trim();

        sqlx::query(
            r#"
            UPDATE users
            SET
                email = ?,
                display_name = ?,
                google_subject = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(canonical_email)
        .bind(display_name.as_deref())
        .bind(google_subject)
        .bind(row.get::<i64, _>("id"))
        .execute(&self.pool)
        .await?;

        self.find_user_by_email(canonical_email)
            .await?
            .ok_or_else(|| StoreError::UnknownUser(normalized_email))
    }

    pub async fn find_user_by_email(&self, email: &str) -> Result<Option<AuthUser>, StoreError> {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() {
            return Ok(None);
        }

        let maybe_row = sqlx::query(
            r#"
            SELECT
                id,
                email,
                normalized_email,
                display_name,
                google_subject,
                platform_role,
                game_role,
                is_active
            FROM users
            WHERE normalized_email = ?
            "#,
        )
        .bind(normalized_email)
        .fetch_optional(&self.pool)
        .await?;

        maybe_row.map(auth_user_from_row).transpose()
    }

    pub async fn create_session(
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

    pub async fn get_session_user(&self, session_id: &str) -> Result<Option<AuthUser>, StoreError> {
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

    pub async fn delete_session(&self, session_id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM auth_sessions WHERE session_id = ?")
            .bind(session_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn update_user_display_name(
        &self,
        user_id: i64,
        display_name: Option<&str>,
    ) -> Result<AuthUser, StoreError> {
        let display_name = sanitize_optional_text(display_name);
        sqlx::query(
            r#"
            UPDATE users
            SET display_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(display_name.as_deref())
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        self.find_user_by_id(user_id)
            .await?
            .ok_or(StoreError::UserNotFound(user_id))
    }

    pub async fn create_user(&self, input: NewUser) -> Result<AuthUser, StoreError> {
        let normalized_email = normalize_email(&input.email);
        if normalized_email.is_empty() {
            return Err(StoreError::InvalidEmail(input.email));
        }

        let canonical_email = input.email.trim().to_string();
        let display_name = sanitize_optional_text(input.display_name.as_deref());

        let result = sqlx::query(
            r#"
            INSERT INTO users (
                email,
                normalized_email,
                display_name,
                platform_role,
                game_role,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&canonical_email)
        .bind(&normalized_email)
        .bind(display_name.as_deref())
        .bind(input.platform_role.as_str())
        .bind(input.game_role.as_str())
        .bind(if input.is_active { 1_i64 } else { 0_i64 })
        .execute(&self.pool)
        .await;

        match result {
            Ok(record) => {
                let user_id = record.last_insert_rowid();
                self.find_user_by_id(user_id)
                    .await?
                    .ok_or(StoreError::UserNotFound(user_id))
            }
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                Err(StoreError::EmailAlreadyExists(normalized_email))
            }
            Err(err) => Err(StoreError::Sqlx(err)),
        }
    }

    pub async fn update_user(
        &self,
        user_id: i64,
        patch: UserPatch,
    ) -> Result<AuthUser, StoreError> {
        let Some(existing) = self.find_user_by_id(user_id).await? else {
            return Err(StoreError::UserNotFound(user_id));
        };

        let next_email = patch
            .email
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(existing.email.as_str())
            .to_string();
        let next_normalized_email = normalize_email(&next_email);
        if next_normalized_email.is_empty() {
            return Err(StoreError::InvalidEmail(next_email));
        }

        let next_display_name = match patch.display_name {
            Some(value) => sanitize_optional_text(Some(value.as_str())),
            None => existing.display_name.clone(),
        };
        let next_platform_role = patch.platform_role.unwrap_or(existing.platform_role);
        let next_game_role = patch.game_role.unwrap_or(existing.game_role);
        let next_is_active = patch.is_active.unwrap_or(existing.is_active);

        let mut tx = self.pool.begin().await?;
        self.ensure_admin_guardrails_tx(&mut tx, &existing, next_platform_role, next_is_active)
            .await?;

        let result = sqlx::query(
            r#"
            UPDATE users
            SET
                email = ?,
                normalized_email = ?,
                display_name = ?,
                platform_role = ?,
                game_role = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(&next_email)
        .bind(&next_normalized_email)
        .bind(next_display_name.as_deref())
        .bind(next_platform_role.as_str())
        .bind(next_game_role.as_str())
        .bind(if next_is_active { 1_i64 } else { 0_i64 })
        .bind(user_id)
        .execute(&mut *tx)
        .await;

        match result {
            Ok(result) => {
                if result.rows_affected() == 0 {
                    return Err(StoreError::UserNotFound(user_id));
                }
                tx.commit().await?;
                self.find_user_by_id(user_id)
                    .await?
                    .ok_or(StoreError::UserNotFound(user_id))
            }
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                Err(StoreError::EmailAlreadyExists(next_normalized_email))
            }
            Err(err) => Err(StoreError::Sqlx(err)),
        }
    }

    pub async fn delete_user(&self, user_id: i64) -> Result<(), StoreError> {
        let Some(existing) = self.find_user_by_id(user_id).await? else {
            return Err(StoreError::UserNotFound(user_id));
        };

        let mut tx = self.pool.begin().await?;
        self.ensure_admin_guardrails_tx(&mut tx, &existing, PlatformRole::User, false)
            .await?;

        let result = sqlx::query("DELETE FROM users WHERE id = ?")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            return Err(StoreError::UserNotFound(user_id));
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn find_user_by_id(&self, user_id: i64) -> Result<Option<AuthUser>, StoreError> {
        let maybe_row = sqlx::query(
            r#"
            SELECT
                id,
                email,
                normalized_email,
                display_name,
                google_subject,
                platform_role,
                game_role,
                is_active
            FROM users
            WHERE id = ?
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        maybe_row.map(auth_user_from_row).transpose()
    }

    async fn ensure_admin_guardrails_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        existing: &AuthUser,
        next_platform_role: PlatformRole,
        next_is_active: bool,
    ) -> Result<(), StoreError> {
        if existing.platform_role != PlatformRole::Admin || !existing.is_active {
            return Ok(());
        }

        if next_platform_role == PlatformRole::Admin && next_is_active {
            return Ok(());
        }

        let remaining_admins = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM users
            WHERE platform_role = 'admin'
              AND is_active = 1
              AND id != ?
            "#,
        )
        .bind(existing.id)
        .fetch_one(&mut **tx)
        .await?;

        if remaining_admins == 0 {
            return Err(StoreError::LastAdminRemoval);
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapUser {
    pub email: String,
    pub normalized_email: String,
    pub platform_role: PlatformRole,
    pub game_role: GameRole,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthUser {
    pub id: i64,
    pub email: String,
    pub normalized_email: String,
    pub display_name: Option<String>,
    pub google_subject: Option<String>,
    pub platform_role: PlatformRole,
    pub game_role: GameRole,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    pub email: String,
    pub display_name: Option<String>,
    pub platform_role: PlatformRole,
    pub game_role: GameRole,
    pub is_active: bool,
}

#[derive(Debug, Clone, Default)]
pub struct UserPatch {
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub platform_role: Option<PlatformRole>,
    pub game_role: Option<GameRole>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformRole {
    Admin,
    User,
}

impl PlatformRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::User => "user",
        }
    }

    fn from_db_value(value: String) -> Result<Self, StoreError> {
        match value.as_str() {
            "admin" => Ok(Self::Admin),
            "user" => Ok(Self::User),
            other => Err(StoreError::InvalidRoleValue(other.to_string())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameRole {
    Gamemaster,
    Player,
}

impl GameRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gamemaster => "gamemaster",
            Self::Player => "player",
        }
    }

    fn from_db_value(value: String) -> Result<Self, StoreError> {
        match value.as_str() {
            "gamemaster" => Ok(Self::Gamemaster),
            "player" => Ok(Self::Player),
            other => Err(StoreError::InvalidRoleValue(other.to_string())),
        }
    }
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("bootstrap user is both gamemaster and player: {0}")]
    ConflictingGameRole(String),
    #[error("user is not allowlisted: {0}")]
    UnknownUser(String),
    #[error("user not found: {0}")]
    UserNotFound(i64),
    #[error("user is inactive: {0}")]
    InactiveUser(String),
    #[error("invalid email: {0}")]
    InvalidEmail(String),
    #[error("email already exists: {0}")]
    EmailAlreadyExists(String),
    #[error("google subject mismatch for {0}; existing subject is {1}")]
    GoogleSubjectMismatch(String, String),
    #[error("cannot remove, demote, or disable the last active admin")]
    LastAdminRemoval,
    #[error("invalid role value in database: {0}")]
    InvalidRoleValue(String),
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
}

pub fn build_bootstrap_users(
    admin_emails: &[String],
    gamemaster_emails: &[String],
    player_emails: &[String],
) -> Result<Vec<BootstrapUser>, StoreError> {
    #[derive(Debug, Clone)]
    struct PendingUser {
        email: String,
        is_admin: bool,
        game_role: GameRole,
    }

    let mut users = BTreeMap::<String, PendingUser>::new();

    for email in admin_emails {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() {
            continue;
        }

        users
            .entry(normalized_email.clone())
            .and_modify(|user| user.is_admin = true)
            .or_insert(PendingUser {
                email: email.trim().to_string(),
                is_admin: true,
                game_role: GameRole::Player,
            });
    }

    for email in gamemaster_emails {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() {
            continue;
        }

        users
            .entry(normalized_email.clone())
            .and_modify(|user| user.game_role = GameRole::Gamemaster)
            .or_insert(PendingUser {
                email: email.trim().to_string(),
                is_admin: false,
                game_role: GameRole::Gamemaster,
            });
    }

    for email in player_emails {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() {
            continue;
        }

        match users.get(&normalized_email) {
            Some(existing) if existing.game_role == GameRole::Gamemaster => {
                return Err(StoreError::ConflictingGameRole(normalized_email));
            }
            Some(_) => {}
            None => {
                users.insert(
                    normalized_email.clone(),
                    PendingUser {
                        email: email.trim().to_string(),
                        is_admin: false,
                        game_role: GameRole::Player,
                    },
                );
            }
        }
    }

    Ok(users
        .into_iter()
        .map(|(normalized_email, user)| BootstrapUser {
            email: user.email,
            normalized_email,
            platform_role: if user.is_admin {
                PlatformRole::Admin
            } else {
                PlatformRole::User
            },
            game_role: user.game_role,
        })
        .collect())
}

fn auth_user_from_row(row: sqlx::sqlite::SqliteRow) -> Result<AuthUser, StoreError> {
    Ok(AuthUser {
        id: row.get("id"),
        email: row.get("email"),
        normalized_email: row.get("normalized_email"),
        display_name: row.get("display_name"),
        google_subject: row.get("google_subject"),
        platform_role: PlatformRole::from_db_value(row.get("platform_role"))?,
        game_role: GameRole::from_db_value(row.get("game_role"))?,
        is_active: row.get::<i64, _>("is_active") != 0,
    })
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn sanitize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

async fn ensure_sqlite_parent_dir(database_url: &str) -> Result<(), StoreError> {
    let Some(path) = sqlite_file_path(database_url) else {
        return Ok(());
    };

    let Some(parent) = Path::new(&path).parent() else {
        return Ok(());
    };

    if parent.as_os_str().is_empty() {
        return Ok(());
    }

    tokio::fs::create_dir_all(parent).await?;
    Ok(())
}

fn sqlite_file_path(database_url: &str) -> Option<String> {
    let raw_path = database_url
        .strip_prefix("sqlite://")
        .or_else(|| database_url.strip_prefix("sqlite:"))?;
    let path = raw_path.split('?').next().unwrap_or(raw_path);

    if path.is_empty() || path == ":memory:" || path.starts_with("file:") {
        return None;
    }

    Some(path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn seeds_bootstrap_users_with_expected_roles() {
        let store = UserStore::connect("sqlite::memory:").await.unwrap();
        let users = build_bootstrap_users(
            &["admin@example.com".to_string()],
            &["gm@example.com".to_string()],
            &["player@example.com".to_string()],
        )
        .unwrap();

        store.seed_bootstrap_users(&users).await.unwrap();

        let stored_users = store.list_users().await.unwrap();
        assert_eq!(stored_users.len(), 3);
        assert_eq!(stored_users[0].platform_role, PlatformRole::Admin);
        assert_eq!(stored_users[0].game_role, GameRole::Player);
        assert_eq!(stored_users[1].game_role, GameRole::Gamemaster);
        assert_eq!(stored_users[2].game_role, GameRole::Player);
    }

    #[tokio::test]
    async fn authorize_google_user_links_subject_and_display_name() {
        let store = UserStore::connect("sqlite::memory:").await.unwrap();
        let users = build_bootstrap_users(&[], &[], &["Player@Example.com".to_string()]).unwrap();
        store.seed_bootstrap_users(&users).await.unwrap();

        let user = store
            .authorize_google_user(" player@example.com ", "google-sub-1", Some("Alice"))
            .await
            .unwrap();

        assert_eq!(user.normalized_email, "player@example.com");
        assert_eq!(user.google_subject.as_deref(), Some("google-sub-1"));
        assert_eq!(user.display_name.as_deref(), Some("Alice"));
    }

    #[tokio::test]
    async fn authorize_google_user_rejects_unknown_email() {
        let store = UserStore::connect("sqlite::memory:").await.unwrap();

        let err = store
            .authorize_google_user("missing@example.com", "google-sub-1", Some("Missing"))
            .await
            .unwrap_err();

        assert!(matches!(err, StoreError::UnknownUser(_)));
    }

    #[tokio::test]
    async fn authorize_google_user_rejects_subject_mismatch() {
        let store = UserStore::connect("sqlite::memory:").await.unwrap();
        let users = build_bootstrap_users(&[], &[], &["player@example.com".to_string()]).unwrap();
        store.seed_bootstrap_users(&users).await.unwrap();

        store
            .authorize_google_user("player@example.com", "google-sub-1", Some("Alice"))
            .await
            .unwrap();

        let err = store
            .authorize_google_user("player@example.com", "google-sub-2", Some("Alice"))
            .await
            .unwrap_err();

        assert!(matches!(err, StoreError::GoogleSubjectMismatch(_, _)));
    }

    #[tokio::test]
    async fn sessions_return_active_user_until_expired_or_deleted() {
        let store = UserStore::connect("sqlite::memory:").await.unwrap();
        let users = build_bootstrap_users(&[], &[], &["player@example.com".to_string()]).unwrap();
        store.seed_bootstrap_users(&users).await.unwrap();

        let user = store
            .authorize_google_user("player@example.com", "google-sub-1", Some("Alice"))
            .await
            .unwrap();

        store
            .create_session(
                "session-1",
                user.id,
                Utc::now() + chrono::Duration::hours(1),
            )
            .await
            .unwrap();

        let session_user = store.get_session_user("session-1").await.unwrap();
        assert_eq!(session_user.as_ref().map(|value| value.id), Some(user.id));

        store.delete_session("session-1").await.unwrap();
        assert!(store.get_session_user("session-1").await.unwrap().is_none());
    }

    #[test]
    fn rejects_conflicting_bootstrap_game_roles() {
        let err = build_bootstrap_users(
            &[],
            &["gm@example.com".to_string()],
            &["gm@example.com".to_string()],
        )
        .unwrap_err();

        assert!(matches!(err, StoreError::ConflictingGameRole(_)));
    }
}
