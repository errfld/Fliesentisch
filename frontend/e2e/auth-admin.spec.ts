import { expect, test } from "@playwright/test";

const E2E_EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? "example.com";

function devLoginUrl(email: string, next: string, name: string): string {
  const params = new URLSearchParams({
    email,
    name,
    next
  });
  return `/api/v1/auth/dev-login?${params.toString()}`;
}

test("home page requires sign-in before join form is shown", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Use your game account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join the room" })).toHaveCount(0);
});

test("admin can manage users and non-admin is blocked from the admin console", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminEmail = `gm@${E2E_EMAIL_DOMAIN}`;

  try {
    await adminPage.goto(devLoginUrl(adminEmail, "/admin", "GM"));
    await expect(adminPage.getByRole("heading", { name: "Allowlist and roles" })).toBeVisible();
    await expect(adminPage.getByTestId("admin-create-form")).toBeVisible();
    await expect(adminPage.getByText(adminEmail)).toBeVisible();
  } finally {
    await adminContext.close();
  }

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();

  try {
    await playerPage.goto(devLoginUrl(`alice@${E2E_EMAIL_DOMAIN}`, "/admin", "Alice"));
    await expect(playerPage.getByText("Admin access required")).toBeVisible();
  } finally {
    await playerContext.close();
  }
});

test("admin creates a campaign preset that an assigned player can select", async ({ browser }) => {
  const adminEmail = `gm@${E2E_EMAIL_DOMAIN}`;
  const playerEmail = `alice@${E2E_EMAIL_DOMAIN}`;
  const roomSlug = `campaign-${Date.now()}`;
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  try {
    await adminPage.goto(devLoginUrl(adminEmail, "/admin", "GM"));
    const form = adminPage.getByTestId("campaign-create-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Display name").fill("The Ashen Ledger");
    await form.getByLabel("Room slug").fill(roomSlug);
    await form.getByLabel(`Seat for ${adminEmail}`).selectOption("gm");
    await form.getByLabel(`Seat for ${playerEmail}`).selectOption("player");
    await form.getByRole("button", { name: "Create campaign" }).click();
    await expect(
      adminPage.getByTestId(/campaign-\d+/).filter({ hasText: roomSlug }).getByText("The Ashen Ledger")
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  try {
    await playerPage.goto(devLoginUrl(playerEmail, "/", "Alice"));
    await expect(playerPage.getByLabel("Campaign table")).toContainText("The Ashen Ledger");
    await playerPage.getByLabel("Campaign table").selectOption(roomSlug);
    await playerPage.getByRole("button", { name: "Enter table" }).click();
    await expect(playerPage.getByRole("heading", { name: "Set the table before play" })).toBeVisible();
    await playerPage.getByTestId("lobby-ready-toggle").click();
    await playerPage.getByTestId("lobby-enter-room").click();
    await expect(playerPage.getByRole("heading", { name: `Room: ${roomSlug}` })).toBeVisible();
  } finally {
    await playerContext.close();
  }
});

test("gamemaster can open the campaign management console without platform admin access", async ({ page }) => {
  await page.goto(devLoginUrl(`keeper@${E2E_EMAIL_DOMAIN}`, "/campaigns", "Keeper"));
  await expect(page.getByRole("heading", { name: "Campaign tables" })).toBeVisible();
  await expect(page.getByTestId("campaign-create-form")).toBeVisible();
});

test("gamemaster invite link provisions a player and revoked links stay closed", async ({ browser }) => {
  const stamp = Date.now();
  const adminEmail = `gm@${E2E_EMAIL_DOMAIN}`;
  const guestEmail = `invite.guest.${stamp}@${E2E_EMAIL_DOMAIN}`;
  const roomSlug = `invite-table-${stamp}`;
  const campaignName = `Invite Table ${stamp}`;
  const adminContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const revokedContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const guestPage = await guestContext.newPage();
  const revokedPage = await revokedContext.newPage();

  try {
    await adminPage.goto(devLoginUrl(adminEmail, "/campaigns", "GM"));
    const campaignForm = adminPage.getByTestId("campaign-create-form");
    await campaignForm.getByLabel("Display name").fill(campaignName);
    await campaignForm.getByLabel("Room slug").fill(roomSlug);
    await campaignForm.getByLabel(`Seat for ${adminEmail}`).selectOption("gm");
    await campaignForm.getByRole("button", { name: "Create campaign" }).click();

    const campaignCard = adminPage.getByTestId(/campaign-\d+/).filter({ hasText: campaignName });
    await expect(campaignCard).toBeVisible();
    const inviteForm = campaignCard.getByTestId("invite-create-form");
    await inviteForm.getByLabel("Max uses").fill("1");
    await inviteForm.getByRole("button", { name: "Create slip" }).click();
    const firstLink = await campaignCard.getByLabel("New invite link").inputValue();
    const firstPath = new URL(firstLink).pathname;

    await guestPage.goto(firstPath);
    await expect(guestPage.getByRole("heading", { name: "A place is set for you" })).toBeVisible();
    await expect(guestPage.getByRole("link", { name: "Continue with Google" })).toBeVisible();
    await guestPage.goto(devLoginUrl(guestEmail, firstPath, "Invite Guest"));
    await expect(guestPage.getByTestId("invite-success")).toContainText(campaignName);
    await guestPage.getByRole("link", { name: `Enter ${campaignName}` }).click();
    await expect(guestPage.getByRole("heading", { name: `Room: ${roomSlug}` })).toBeVisible();

    await inviteForm.getByRole("button", { name: "Create slip" }).click();
    const newInviteLink = campaignCard.getByLabel("New invite link");
    await expect(newInviteLink).not.toHaveValue(firstLink);
    const secondLink = await newInviteLink.inputValue();
    const secondPath = new URL(secondLink).pathname;
    const newestInvite = campaignCard.getByTestId(/^invite-\d+$/).first();
    await newestInvite.getByRole("button", { name: "Revoke" }).click();
    await expect(newestInvite).toContainText("revoked");

    await revokedPage.goto(secondPath);
    await expect(revokedPage.getByText("This invitation was revoked by its gamemaster.")).toBeVisible();
  } finally {
    await Promise.all([adminContext.close(), guestContext.close(), revokedContext.close()]);
  }
});
