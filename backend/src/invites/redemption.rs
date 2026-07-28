use chrono::Utc;
use sqlx::{Row, SqlitePool};

use super::model::{clean_optional_text, hash_token, validate_redeemable_row};
use super::{InviteStoreError, RedeemedInvite};

pub(super) struct RedeemInviteInput<'a> {
    pub(super) raw_token: &'a str,
    pub(super) email: &'a str,
    pub(super) google_subject: &'a str,
    pub(super) display_name: Option<&'a str>,
}

pub(super) async fn redeem_invite(
    pool: &SqlitePool,
    input: RedeemInviteInput<'_>,
) -> Result<RedeemedInvite, InviteStoreError> {
    let RedeemInviteInput {
        raw_token,
        email,
        google_subject,
        display_name,
    } = input;
    let normalized_email = email.trim().to_lowercase();
    if normalized_email.is_empty() || google_subject.trim().is_empty() {
        return Err(InviteStoreError::InvalidIdentity);
    }
    let now = Utc::now().timestamp();
    let mut tx = pool.begin().await?;
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
