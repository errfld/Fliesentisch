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

    pub async fn find_active_user_by_email(
        &self,
        email: &str,
    ) -> Result<Option<StoredUser>, StoreError> {
        let normalized_email = normalize_email(email);
        if normalized_email.is_empty() {
            return Ok(None);
        }

        let row = sqlx::query(
            r#"
            SELECT email, normalized_email, platform_role, game_role, is_active
            FROM users
            WHERE normalized_email = ? AND is_active = 1
            LIMIT 1
            "#,
        )
        .bind(normalized_email)
        .fetch_optional(&self.pool)
        .await?;

        row.map(stored_user_from_row).transpose()
    }

    #[cfg(test)]
    pub async fn list_users(&self) -> Result<Vec<StoredUser>, StoreError> {
        let rows = sqlx::query(
            r#"
            SELECT email, normalized_email, platform_role, game_role, is_active
            FROM users
            ORDER BY normalized_email ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(stored_user_from_row).collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapUser {
    pub email: String,
    pub normalized_email: String,
    pub platform_role: PlatformRole,
    pub game_role: GameRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredUser {
    pub email: String,
    pub normalized_email: String,
    pub platform_role: PlatformRole,
    pub game_role: GameRole,
    pub is_active: bool,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("bootstrap user is both gamemaster and player: {0}")]
    ConflictingGameRole(String),
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

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn stored_user_from_row(row: sqlx::sqlite::SqliteRow) -> Result<StoredUser, StoreError> {
    Ok(StoredUser {
        email: row.get("email"),
        normalized_email: row.get("normalized_email"),
        platform_role: PlatformRole::from_db_value(row.get("platform_role"))?,
        game_role: GameRole::from_db_value(row.get("game_role"))?,
        is_active: row.get::<i64, _>("is_active") != 0,
    })
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

    #[tokio::test]
    async fn finds_active_user_by_email_case_insensitively() {
        let store = UserStore::connect("sqlite::memory:").await.unwrap();
        let users = build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap();
        store.seed_bootstrap_users(&users).await.unwrap();

        let user = store
            .find_active_user_by_email("  GM@EXAMPLE.COM ")
            .await
            .unwrap()
            .expect("user");

        assert_eq!(user.normalized_email, "gm@example.com");
        assert_eq!(user.game_role, GameRole::Gamemaster);
    }
}
