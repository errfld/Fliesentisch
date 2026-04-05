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

  await expect(page.getByRole("heading", { name: "Enter through Google" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join the table" })).toHaveCount(0);
});

test("admin can manage users and non-admin is blocked from the admin console", async ({ browser }, testInfo) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  void testInfo;

  try {
    await adminPage.goto(devLoginUrl(`gm@${E2E_EMAIL_DOMAIN}`, "/admin", "GM"));
    await expect(adminPage.getByRole("heading", { name: "Allowlist and roles" })).toBeVisible();
    await expect(adminPage.getByTestId("admin-create-form")).toBeVisible();
    await expect(adminPage.getByText("gm@example.com")).toBeVisible();
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
