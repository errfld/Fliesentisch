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
    await expect(adminPage.getByTestId(/campaign-\d+/).getByText("The Ashen Ledger")).toBeVisible();
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
