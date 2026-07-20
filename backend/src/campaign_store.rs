use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::BTreeSet;
use thiserror::Error;

use crate::users::GameRole;

#[derive(Debug, Error)]
pub(crate) enum CampaignStoreError {
    #[error("campaign not found: {0}")]
    CampaignNotFound(i64),
    #[error("campaign room slug already exists: {0}")]
    CampaignSlugAlreadyExists(String),
    #[error("invalid role value in database: {0}")]
    InvalidRoleValue(String),
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("invalid stored JSON: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub(crate) struct CampaignStore {
    pool: SqlitePool,
}

impl CampaignStore {
    pub(crate) async fn initialize(pool: SqlitePool) -> Result<Self, CampaignStoreError> {
        let store = Self { pool };
        let mut tx = store.pool.begin().await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS campaign_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                display_name TEXT NOT NULL,
                room_slug TEXT NOT NULL UNIQUE,
                default_split_room_names TEXT NOT NULL DEFAULT '[]',
                is_archived INTEGER NOT NULL DEFAULT 0,
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS campaign_members (
                campaign_id INTEGER NOT NULL REFERENCES campaign_presets(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                game_role TEXT NOT NULL CHECK (game_role IN ('gamemaster', 'player')),
                PRIMARY KEY (campaign_id, user_id)
            )
            "#,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(store)
    }

    pub(crate) async fn list_campaigns_for_user(
        &self,
        user_id: i64,
        is_admin: bool,
    ) -> Result<Vec<CampaignPreset>, CampaignStoreError> {
        let rows = if is_admin {
            sqlx::query(
                r#"
                SELECT id, display_name, room_slug, default_split_room_names,
                       is_archived, created_at, updated_at
                FROM campaign_presets
                WHERE is_archived = 0
                ORDER BY display_name COLLATE NOCASE ASC
                "#,
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                r#"
                SELECT campaign_presets.id, campaign_presets.display_name,
                       campaign_presets.room_slug,
                       campaign_presets.default_split_room_names,
                       campaign_presets.is_archived,
                       campaign_presets.created_at,
                       campaign_presets.updated_at
                FROM campaign_presets
                INNER JOIN campaign_members
                    ON campaign_members.campaign_id = campaign_presets.id
                WHERE campaign_members.user_id = ?
                  AND campaign_presets.is_archived = 0
                ORDER BY campaign_presets.display_name COLLATE NOCASE ASC
                "#,
            )
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?
        };
        self.campaigns_from_rows(rows).await
    }

    pub(crate) async fn list_managed_campaigns(
        &self,
        user_id: i64,
        is_admin: bool,
    ) -> Result<Vec<CampaignPreset>, CampaignStoreError> {
        let rows = if is_admin {
            sqlx::query(
                r#"
                SELECT id, display_name, room_slug, default_split_room_names,
                       is_archived, created_at, updated_at
                FROM campaign_presets
                ORDER BY is_archived ASC, display_name COLLATE NOCASE ASC
                "#,
            )
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                r#"
                SELECT campaign_presets.id, campaign_presets.display_name,
                       campaign_presets.room_slug,
                       campaign_presets.default_split_room_names,
                       campaign_presets.is_archived,
                       campaign_presets.created_at,
                       campaign_presets.updated_at
                FROM campaign_presets
                INNER JOIN campaign_members
                    ON campaign_members.campaign_id = campaign_presets.id
                WHERE campaign_members.user_id = ?
                  AND campaign_members.game_role = 'gamemaster'
                ORDER BY campaign_presets.is_archived ASC,
                         campaign_presets.display_name COLLATE NOCASE ASC
                "#,
            )
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?
        };
        self.campaigns_from_rows(rows).await
    }

    pub(crate) async fn create_campaign(
        &self,
        creator_user_id: i64,
        input: CampaignInput,
    ) -> Result<CampaignPreset, CampaignStoreError> {
        let room_slug = normalize_room_slug(&input.room_slug);
        let split_rooms =
            serde_json::to_string(&sanitize_split_room_names(&input.default_split_room_names))?;
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            r#"
            INSERT INTO campaign_presets (
                display_name, room_slug, default_split_room_names, is_archived, created_by_user_id
            ) VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(input.display_name.trim())
        .bind(&room_slug)
        .bind(split_rooms)
        .bind(if input.is_archived { 1_i64 } else { 0_i64 })
        .bind(creator_user_id)
        .execute(&mut *tx)
        .await;

        let campaign_id = match result {
            Ok(record) => record.last_insert_rowid(),
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                return Err(CampaignStoreError::CampaignSlugAlreadyExists(room_slug));
            }
            Err(err) => return Err(CampaignStoreError::Sqlx(err)),
        };
        replace_campaign_members(&mut tx, campaign_id, &input).await?;
        tx.commit().await?;
        self.find_campaign_by_id(campaign_id)
            .await?
            .ok_or(CampaignStoreError::CampaignNotFound(campaign_id))
    }

    pub(crate) async fn update_campaign(
        &self,
        campaign_id: i64,
        input: CampaignInput,
    ) -> Result<CampaignPreset, CampaignStoreError> {
        let room_slug = normalize_room_slug(&input.room_slug);
        let split_rooms =
            serde_json::to_string(&sanitize_split_room_names(&input.default_split_room_names))?;
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            r#"
            UPDATE campaign_presets
            SET display_name = ?, room_slug = ?, default_split_room_names = ?,
                is_archived = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(input.display_name.trim())
        .bind(&room_slug)
        .bind(split_rooms)
        .bind(if input.is_archived { 1_i64 } else { 0_i64 })
        .bind(campaign_id)
        .execute(&mut *tx)
        .await;

        match result {
            Ok(result) if result.rows_affected() == 0 => {
                return Err(CampaignStoreError::CampaignNotFound(campaign_id));
            }
            Ok(_) => {}
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                return Err(CampaignStoreError::CampaignSlugAlreadyExists(room_slug));
            }
            Err(err) => return Err(CampaignStoreError::Sqlx(err)),
        }
        replace_campaign_members(&mut tx, campaign_id, &input).await?;
        tx.commit().await?;
        self.find_campaign_by_id(campaign_id)
            .await?
            .ok_or(CampaignStoreError::CampaignNotFound(campaign_id))
    }

    pub(crate) async fn archive_campaign(
        &self,
        campaign_id: i64,
    ) -> Result<(), CampaignStoreError> {
        let result = sqlx::query(
            "UPDATE campaign_presets SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(campaign_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(CampaignStoreError::CampaignNotFound(campaign_id));
        }
        Ok(())
    }

    pub(crate) async fn find_campaign_by_room_slug(
        &self,
        room_slug: &str,
    ) -> Result<Option<CampaignPreset>, CampaignStoreError> {
        let row = sqlx::query(
            r#"
            SELECT id, display_name, room_slug, default_split_room_names,
                   is_archived, created_at, updated_at
            FROM campaign_presets
            WHERE room_slug = ?
            "#,
        )
        .bind(normalize_room_slug(room_slug))
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => Ok(Some(self.campaign_from_row(row).await?)),
            None => Ok(None),
        }
    }

    pub(crate) async fn campaign_role_for_user(
        &self,
        campaign_id: i64,
        user_id: i64,
    ) -> Result<Option<GameRole>, CampaignStoreError> {
        let role = sqlx::query_scalar::<_, String>(
            "SELECT game_role FROM campaign_members WHERE campaign_id = ? AND user_id = ?",
        )
        .bind(campaign_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        match role.as_deref() {
            Some("gamemaster") => Ok(Some(GameRole::Gamemaster)),
            Some("player") => Ok(Some(GameRole::Player)),
            Some(other) => Err(CampaignStoreError::InvalidRoleValue(other.to_string())),
            None => Ok(None),
        }
    }

    pub(crate) async fn user_can_manage_campaign(
        &self,
        campaign_id: i64,
        user_id: i64,
        is_admin: bool,
    ) -> Result<bool, CampaignStoreError> {
        if is_admin {
            return Ok(true);
        }
        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*) FROM campaign_members
            WHERE campaign_id = ? AND user_id = ? AND game_role = 'gamemaster'
            "#,
        )
        .bind(campaign_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub(crate) async fn find_campaign_by_id(
        &self,
        campaign_id: i64,
    ) -> Result<Option<CampaignPreset>, CampaignStoreError> {
        let row = sqlx::query(
            r#"
            SELECT id, display_name, room_slug, default_split_room_names,
                   is_archived, created_at, updated_at
            FROM campaign_presets WHERE id = ?
            "#,
        )
        .bind(campaign_id)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => Ok(Some(self.campaign_from_row(row).await?)),
            None => Ok(None),
        }
    }

    async fn campaigns_from_rows(
        &self,
        rows: Vec<sqlx::sqlite::SqliteRow>,
    ) -> Result<Vec<CampaignPreset>, CampaignStoreError> {
        let mut campaigns = Vec::with_capacity(rows.len());
        for row in rows {
            campaigns.push(self.campaign_from_row(row).await?);
        }
        Ok(campaigns)
    }

    async fn campaign_from_row(
        &self,
        row: sqlx::sqlite::SqliteRow,
    ) -> Result<CampaignPreset, CampaignStoreError> {
        let campaign_id = row.get::<i64, _>("id");
        let member_rows = sqlx::query(
            "SELECT user_id, game_role FROM campaign_members WHERE campaign_id = ? ORDER BY user_id",
        )
        .bind(campaign_id)
        .fetch_all(&self.pool)
        .await?;
        let mut gamemaster_user_ids = Vec::new();
        let mut player_user_ids = Vec::new();
        for member in member_rows {
            match member.get::<String, _>("game_role").as_str() {
                "gamemaster" => gamemaster_user_ids.push(member.get("user_id")),
                "player" => player_user_ids.push(member.get("user_id")),
                other => return Err(CampaignStoreError::InvalidRoleValue(other.to_string())),
            }
        }
        let split_room_json = row.get::<String, _>("default_split_room_names");
        Ok(CampaignPreset {
            id: campaign_id,
            display_name: row.get("display_name"),
            room_slug: row.get("room_slug"),
            gamemaster_user_ids,
            player_user_ids,
            default_split_room_names: serde_json::from_str(&split_room_json)?,
            is_archived: row.get::<i64, _>("is_archived") != 0,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct CampaignPreset {
    pub(crate) id: i64,
    pub(crate) display_name: String,
    pub(crate) room_slug: String,
    pub(crate) gamemaster_user_ids: Vec<i64>,
    pub(crate) player_user_ids: Vec<i64>,
    pub(crate) default_split_room_names: Vec<String>,
    pub(crate) is_archived: bool,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CampaignInput {
    pub(crate) display_name: String,
    pub(crate) room_slug: String,
    pub(crate) gamemaster_user_ids: Vec<i64>,
    pub(crate) player_user_ids: Vec<i64>,
    pub(crate) default_split_room_names: Vec<String>,
    pub(crate) is_archived: bool,
}

async fn replace_campaign_members(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    campaign_id: i64,
    input: &CampaignInput,
) -> Result<(), CampaignStoreError> {
    sqlx::query("DELETE FROM campaign_members WHERE campaign_id = ?")
        .bind(campaign_id)
        .execute(&mut **tx)
        .await?;
    let mut inserted_user_ids = BTreeSet::new();
    for user_id in &input.gamemaster_user_ids {
        if !inserted_user_ids.insert(*user_id) {
            continue;
        }
        sqlx::query(
            "INSERT INTO campaign_members (campaign_id, user_id, game_role) VALUES (?, ?, 'gamemaster')",
        )
        .bind(campaign_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    }
    for user_id in &input.player_user_ids {
        if !inserted_user_ids.insert(*user_id) {
            continue;
        }
        sqlx::query(
            "INSERT INTO campaign_members (campaign_id, user_id, game_role) VALUES (?, ?, 'player')",
        )
        .bind(campaign_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

fn normalize_room_slug(value: &str) -> String {
    value.trim().to_lowercase()
}

fn sanitize_split_room_names(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::users::{build_bootstrap_users, UserStore};
    use chrono::Utc;

    async fn stores(database_url: &str) -> (UserStore, CampaignStore) {
        let users = UserStore::connect(database_url).await.unwrap();
        let campaigns = CampaignStore::initialize(users.sqlite_pool())
            .await
            .unwrap();
        (users, campaigns)
    }

    #[tokio::test]
    async fn campaign_presets_persist_membership_and_archive_state() {
        let (users, campaigns) = stores("sqlite::memory:").await;
        let bootstrap = build_bootstrap_users(
            &["admin@example.com".to_string()],
            &["gm@example.com".to_string()],
            &["player@example.com".to_string()],
        )
        .unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let admin = users
            .find_user_by_email("admin@example.com")
            .await
            .unwrap()
            .unwrap();
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let player = users
            .find_user_by_email("player@example.com")
            .await
            .unwrap()
            .unwrap();

        let campaign = campaigns
            .create_campaign(
                admin.id,
                CampaignInput {
                    display_name: "Thursday Night".to_string(),
                    room_slug: "Thursday-Night".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![player.id],
                    default_split_room_names: vec![" Library ".to_string()],
                    is_archived: false,
                },
            )
            .await
            .unwrap();

        assert_eq!(campaign.room_slug, "thursday-night");
        assert_eq!(campaign.default_split_room_names, vec!["Library"]);
        assert_eq!(
            campaigns
                .campaign_role_for_user(campaign.id, player.id)
                .await
                .unwrap(),
            Some(GameRole::Player)
        );
        assert!(campaigns
            .user_can_manage_campaign(campaign.id, gm.id, false)
            .await
            .unwrap());
        assert!(!campaigns
            .user_can_manage_campaign(campaign.id, player.id, false)
            .await
            .unwrap());
        assert_eq!(
            campaigns
                .list_campaigns_for_user(player.id, false)
                .await
                .unwrap()
                .len(),
            1
        );

        campaigns.archive_campaign(campaign.id).await.unwrap();
        assert!(campaigns
            .list_campaigns_for_user(player.id, false)
            .await
            .unwrap()
            .is_empty());
        assert!(
            campaigns
                .find_campaign_by_room_slug("thursday-night")
                .await
                .unwrap()
                .unwrap()
                .is_archived
        );
    }

    #[tokio::test]
    async fn campaign_room_slugs_are_unique() {
        let (users, campaigns) = stores("sqlite::memory:").await;
        let bootstrap = build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let input = CampaignInput {
            display_name: "First".to_string(),
            room_slug: "same-room".to_string(),
            gamemaster_user_ids: vec![gm.id],
            player_user_ids: vec![],
            default_split_room_names: vec![],
            is_archived: false,
        };
        campaigns
            .create_campaign(gm.id, input.clone())
            .await
            .unwrap();
        let error = campaigns.create_campaign(gm.id, input).await.unwrap_err();
        assert!(matches!(
            error,
            CampaignStoreError::CampaignSlugAlreadyExists(_)
        ));
    }

    #[tokio::test]
    async fn campaign_presets_survive_database_reconnect() {
        let path = std::env::temp_dir().join(format!(
            "virtual-table-campaign-{}-{}.sqlite",
            std::process::id(),
            Utc::now().timestamp_micros()
        ));
        std::fs::File::create(&path).unwrap();
        let database_url = format!("sqlite://{}", path.display());
        let (users, campaigns) = stores(&database_url).await;
        let bootstrap = build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        campaigns
            .create_campaign(
                gm.id,
                CampaignInput {
                    display_name: "Persistent Table".to_string(),
                    room_slug: "persistent-table".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        users.sqlite_pool().close().await;

        let (reopened_users, reopened_campaigns) = stores(&database_url).await;
        assert!(reopened_campaigns
            .find_campaign_by_room_slug("persistent-table")
            .await
            .unwrap()
            .is_some());
        reopened_users.sqlite_pool().close().await;
        std::fs::remove_file(path).unwrap();
    }
}
