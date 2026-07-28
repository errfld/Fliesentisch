use chrono::Utc;
use sqlx::Row;

mod handlers;
mod model;
mod store;

use model::{clean_optional_text, hash_token, validate_redeemable_row};

pub(crate) use handlers::{
    create_campaign_invite, inspect_campaign_invite, invite_error_code, invite_to_api_error,
    invite_token_from_next, list_campaign_invites, redeem_campaign_invite, revoke_campaign_invite,
};
pub(crate) use model::{
    CampaignInvite, CreateInviteInput, InviteRole, InviteStatus, InviteStoreError, PublicInvite,
    RedeemedInvite,
};
pub(crate) use store::InviteStore;

impl InviteStore {
    pub(crate) async fn redeem_invite(
        &self,
        raw_token: &str,
        email: &str,
        google_subject: &str,
        display_name: Option<&str>,
    ) -> Result<RedeemedInvite, InviteStoreError> {
        let normalized_email = email.trim().to_lowercase();
        if normalized_email.is_empty() || google_subject.trim().is_empty() {
            return Err(InviteStoreError::InvalidIdentity);
        }
        let now = Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            r#"
            SELECT campaign_invites.id, campaign_invites.campaign_id,
                   campaign_presets.display_name AS campaign_display_name,
                   campaign_presets.room_slug, campaign_presets.is_archived,
                   campaign_invites.expires_at, campaign_invites.max_uses,
                   campaign_invites.use_count, campaign_invites.revoked_at
            FROM campaign_invites
            INNER JOIN campaign_presets ON campaign_presets.id = campaign_invites.campaign_id
            WHERE campaign_invites.token_hash = ?
            "#,
        )
        .bind(hash_token(raw_token))
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(InviteStoreError::InviteNotFound)?;
        let invite_id = row.get::<i64, _>("id");
        let campaign_id = row.get::<i64, _>("campaign_id");
        let campaign_display_name = row.get::<String, _>("campaign_display_name");
        let room_slug = row.get::<String, _>("room_slug");

        let existing = sqlx::query(
            "SELECT id, google_subject, platform_role, game_role, is_active FROM users WHERE normalized_email = ?",
        )
        .bind(&normalized_email)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = existing.as_ref() {
            let is_privileged = existing.get::<String, _>("platform_role") == "admin"
                || existing.get::<String, _>("game_role") == "gamemaster";
            if existing.get::<i64, _>("is_active") == 0 && is_privileged {
                return Err(InviteStoreError::PrivilegedIdentity);
            }
            let existing_subject = existing.get::<Option<String>, _>("google_subject");
            if existing_subject
                .as_deref()
                .is_some_and(|subject| subject != google_subject)
            {
                return Err(InviteStoreError::IdentityMismatch);
            }
            let user_id = existing.get::<i64, _>("id");
            let already_redeemed = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM campaign_invite_redemptions WHERE invite_id = ? AND user_id = ?",
            )
            .bind(invite_id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?
                > 0;
            if already_redeemed {
                tx.commit().await?;
                return Ok(RedeemedInvite {
                    user_id,
                    campaign_id,
                    campaign_display_name,
                    room_slug,
                });
            }
        }

        validate_redeemable_row(&row, now)?;

        let (user_id, created_user) = if let Some(existing) = existing {
            let user_id = existing.get::<i64, _>("id");
            sqlx::query(
                r#"
                UPDATE users
                SET email = ?, display_name = COALESCE(?, display_name),
                    google_subject = COALESCE(google_subject, ?), is_active = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                "#,
            )
            .bind(email.trim())
            .bind(clean_optional_text(display_name))
            .bind(google_subject)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
            (user_id, false)
        } else {
            let result = sqlx::query(
                r#"
                INSERT INTO users (
                    email, normalized_email, display_name, google_subject,
                    platform_role, game_role, is_active
                ) VALUES (?, ?, ?, ?, 'user', 'player', 1)
                "#,
            )
            .bind(email.trim())
            .bind(&normalized_email)
            .bind(clean_optional_text(display_name))
            .bind(google_subject)
            .execute(&mut *tx)
            .await?;
            (result.last_insert_rowid(), true)
        };

        let consumed = sqlx::query(
            r#"
            UPDATE campaign_invites
            SET use_count = use_count + 1
            WHERE id = ? AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > ?)
              AND (max_uses IS NULL OR use_count < max_uses)
            "#,
        )
        .bind(invite_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        if consumed.rows_affected() != 1 {
            return Err(InviteStoreError::Exhausted);
        }
        sqlx::query("INSERT INTO campaign_invite_redemptions (invite_id, user_id) VALUES (?, ?)")
            .bind(invite_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"
            INSERT INTO campaign_members (campaign_id, user_id, game_role)
            VALUES (?, ?, 'player')
            ON CONFLICT(campaign_id, user_id) DO NOTHING
            "#,
        )
        .bind(campaign_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        if created_user {
            sqlx::query("INSERT INTO invite_restricted_users (user_id) VALUES (?)")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(RedeemedInvite {
            user_id,
            campaign_id,
            campaign_display_name,
            room_slug,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::campaign_store::{CampaignInput, CampaignStore};
    use crate::users::{build_bootstrap_users, GameRole, PlatformRole, UserPatch, UserStore};

    async fn stores() -> (UserStore, CampaignStore, InviteStore, i64, i64) {
        let users = UserStore::connect("sqlite::memory:").await.unwrap();
        let campaigns = CampaignStore::initialize(users.sqlite_pool())
            .await
            .unwrap();
        let invite_store = InviteStore::initialize(users.sqlite_pool()).await.unwrap();
        let bootstrap = build_bootstrap_users(
            &[],
            &["gm@example.com".to_string()],
            &["player@example.com".to_string()],
        )
        .unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
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
                gm.id,
                CampaignInput {
                    display_name: "Thursday Night".to_string(),
                    room_slug: "thursday-night".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        (users, campaigns, invite_store, campaign.id, player.id)
    }

    #[tokio::test]
    async fn redemption_creates_restricted_player_and_is_idempotent() {
        let (users, campaigns, invites, campaign_id, _) = stores().await;
        invites
            .create_invite(
                campaign_id,
                1,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: Some(1),
                },
                "secret-token",
            )
            .await
            .unwrap();

        let first = invites
            .redeem_invite(
                "secret-token",
                "guest@example.com",
                "google-guest",
                Some("Guest"),
            )
            .await
            .unwrap();
        let second = invites
            .redeem_invite(
                "secret-token",
                "guest@example.com",
                "google-guest",
                Some("Guest"),
            )
            .await
            .unwrap();

        assert_eq!(first.user_id, second.user_id);
        let user = users
            .find_user_by_email("guest@example.com")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(user.platform_role, PlatformRole::User);
        assert_eq!(user.game_role, GameRole::Player);
        assert_eq!(
            campaigns
                .campaign_role_for_user(campaign_id, user.id)
                .await
                .unwrap(),
            Some(GameRole::Player)
        );
        assert!(invites.is_user_invite_restricted(user.id).await.unwrap());
        assert_eq!(
            invites.list_invites(campaign_id).await.unwrap()[0].use_count,
            1
        );
    }

    #[tokio::test]
    async fn max_use_expiry_and_revocation_are_enforced() {
        let (_users, _campaigns, invites, campaign_id, _) = stores().await;
        let input = CreateInviteInput {
            expires_at: None,
            max_uses: Some(1),
        };
        let invite = invites
            .create_invite(campaign_id, 1, &input, "single-use")
            .await
            .unwrap();
        invites
            .redeem_invite("single-use", "one@example.com", "subject-one", None)
            .await
            .unwrap();
        assert!(matches!(
            invites
                .redeem_invite("single-use", "two@example.com", "subject-two", None)
                .await,
            Err(InviteStoreError::Exhausted)
        ));

        let revoked = invites
            .create_invite(campaign_id, 1, &input, "revoked")
            .await
            .unwrap();
        invites
            .revoke_invite(campaign_id, revoked.id)
            .await
            .unwrap();
        assert!(matches!(
            invites
                .redeem_invite("revoked", "three@example.com", "subject-three", None)
                .await,
            Err(InviteStoreError::Revoked)
        ));

        invites
            .create_invite(
                campaign_id,
                1,
                &CreateInviteInput {
                    expires_at: Some(Utc::now().timestamp() - 1),
                    max_uses: None,
                },
                "expired",
            )
            .await
            .unwrap();
        assert!(matches!(
            invites
                .redeem_invite("expired", "four@example.com", "subject-four", None)
                .await,
            Err(InviteStoreError::Expired)
        ));
        assert_eq!(invite.status, InviteStatus::Active);
    }

    #[tokio::test]
    async fn redemption_never_promotes_existing_player() {
        let (users, campaigns, invites, campaign_id, player_id) = stores().await;
        invites
            .create_invite(
                campaign_id,
                1,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: None,
                },
                "player-only",
            )
            .await
            .unwrap();
        invites
            .redeem_invite(
                "player-only",
                "player@example.com",
                "google-player",
                Some("Player"),
            )
            .await
            .unwrap();
        let user = users.find_user_by_id(player_id).await.unwrap().unwrap();
        assert_eq!(user.platform_role, PlatformRole::User);
        assert_eq!(user.game_role, GameRole::Player);
        assert_eq!(
            campaigns
                .campaign_role_for_user(campaign_id, player_id)
                .await
                .unwrap(),
            Some(GameRole::Player)
        );
    }

    #[tokio::test]
    async fn invite_cannot_reactivate_a_privileged_user() {
        let (users, _campaigns, invites, campaign_id, _) = stores().await;
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        users
            .update_user(
                gm.id,
                UserPatch {
                    is_active: Some(false),
                    ..UserPatch::default()
                },
            )
            .await
            .unwrap();
        invites
            .create_invite(
                campaign_id,
                gm.id,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: None,
                },
                "no-privilege-reactivation",
            )
            .await
            .unwrap();

        assert!(matches!(
            invites
                .redeem_invite(
                    "no-privilege-reactivation",
                    "gm@example.com",
                    "google-gm",
                    Some("GM"),
                )
                .await,
            Err(InviteStoreError::PrivilegedIdentity)
        ));
    }

    #[tokio::test]
    async fn invites_survive_database_reconnect_without_persisting_the_raw_token() {
        let path = std::env::temp_dir().join(format!(
            "virtual-table-invite-{}-{}.sqlite",
            std::process::id(),
            Utc::now().timestamp_micros()
        ));
        std::fs::File::create(&path).unwrap();
        let database_url = format!("sqlite://{}", path.display());
        let users = UserStore::connect(&database_url).await.unwrap();
        let campaigns = CampaignStore::initialize(users.sqlite_pool())
            .await
            .unwrap();
        let invites = InviteStore::initialize(users.sqlite_pool()).await.unwrap();
        let bootstrap = build_bootstrap_users(&[], &["gm@example.com".to_string()], &[]).unwrap();
        users.seed_bootstrap_users(&bootstrap).await.unwrap();
        let gm = users
            .find_user_by_email("gm@example.com")
            .await
            .unwrap()
            .unwrap();
        let campaign = campaigns
            .create_campaign(
                gm.id,
                CampaignInput {
                    display_name: "Persistent Invite Table".to_string(),
                    room_slug: "persistent-invite-table".to_string(),
                    gamemaster_user_ids: vec![gm.id],
                    player_user_ids: vec![],
                    default_split_room_names: vec![],
                    is_archived: false,
                },
            )
            .await
            .unwrap();
        invites
            .create_invite(
                campaign.id,
                gm.id,
                &CreateInviteInput {
                    expires_at: None,
                    max_uses: Some(3),
                },
                "raw-token-is-not-stored",
            )
            .await
            .unwrap();
        users.sqlite_pool().close().await;

        let reopened_users = UserStore::connect(&database_url).await.unwrap();
        CampaignStore::initialize(reopened_users.sqlite_pool())
            .await
            .unwrap();
        let reopened_pool = reopened_users.sqlite_pool();
        let reopened_invites = InviteStore::initialize(reopened_pool.clone())
            .await
            .unwrap();
        let persisted = reopened_invites.list_invites(campaign.id).await.unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].token_hint, "raw-toke");
        assert_eq!(persisted[0].max_uses, Some(3));
        assert_eq!(
            reopened_invites
                .inspect_invite("raw-token-is-not-stored")
                .await
                .unwrap()
                .status,
            InviteStatus::Active
        );
        let raw_token_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM campaign_invites WHERE token_hash = ?",
        )
        .bind("raw-token-is-not-stored")
        .fetch_one(&reopened_pool)
        .await
        .unwrap();
        assert_eq!(raw_token_count, 0);

        reopened_pool.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
