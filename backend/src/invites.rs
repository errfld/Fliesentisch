mod handlers;
mod model;
mod redemption;
mod store;

use redemption::RedeemInviteInput;

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
        redemption::redeem_invite(
            &self.pool,
            RedeemInviteInput {
                raw_token,
                email,
                google_subject,
                display_name,
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::campaign_store::{CampaignInput, CampaignStore};
    use crate::users::{build_bootstrap_users, GameRole, PlatformRole, UserPatch, UserStore};
    use chrono::Utc;

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
