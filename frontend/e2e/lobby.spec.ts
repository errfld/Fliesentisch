import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const ROOM = process.env.E2E_ROOM ?? "dnd-table-1";
const DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? "example.com";

function devLoginUrl(email: string, name: string): string {
  const next = `/room/${encodeURIComponent(ROOM)}?name=${encodeURIComponent(name)}`;
  return `/api/v1/auth/dev-login?${new URLSearchParams({ email, name, next }).toString()}`;
}

async function openLobby(browser: Browser, email: string, name: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(devLoginUrl(email, name));
  await expect(page.getByRole("heading", { name: "Set the table before play" })).toBeVisible();
  return page;
}

test("readiness propagates and the GM can explicitly start before everyone is ready", async ({ browser }) => {
  const gmPage = await openLobby(browser, `gm@${DOMAIN}`, "GM");
  const alicePage = await openLobby(browser, `alice@${DOMAIN}`, "Alice");

  try {
    await alicePage.getByTestId("lobby-ready-toggle").click();
    const aliceRow = gmPage.getByTestId("lobby-readiness-list").getByText("Alice").locator("..");
    await expect(aliceRow).toContainText("Ready");

    await gmPage.getByTestId("lobby-enter-room").click();
    await expect(gmPage.getByText(/participant is still setting up/i)).toBeVisible();
    await gmPage.getByTestId("lobby-enter-room").click();
    await expect(gmPage.getByRole("heading", { name: `Room: ${ROOM}` })).toBeVisible();

    await alicePage.getByTestId("lobby-enter-room").click();
    await expect(alicePage.getByRole("heading", { name: `Room: ${ROOM}` })).toBeVisible();
  } finally {
    await gmPage.context().close();
    await alicePage.context().close();
  }
});
