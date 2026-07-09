import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page, Route } from "@playwright/test";

const TEST_ROOM = process.env.E2E_ROOM ?? "dnd-table-1";
const E2E_EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? "example.com";
const FIRST_IMAGE_URL = "https://assets.example.test/observatory.svg";
const UPDATED_IMAGE_URL = "https://assets.example.test/star-chart.svg";

function devLoginUrl(room: string, displayName: string): string {
  const next = `/room/${encodeURIComponent(room)}?name=${encodeURIComponent(displayName)}`;
  const emailLocalPart = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  const params = new URLSearchParams({
    email: `${emailLocalPart || "player"}@${E2E_EMAIL_DOMAIN}`,
    name: displayName,
    next
  });
  return `/api/v1/auth/dev-login?${params.toString()}`;
}

type ParticipantClient = {
  context: BrowserContext;
  page: Page;
};

async function fulfillHandoutImage(route: Route): Promise<void> {
  const isUpdated = route.request().url().includes("star-chart");
  await route.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="${isUpdated ? "#101b2d" : "#24150e"}"/><circle cx="400" cy="225" r="120" fill="none" stroke="#c9963e" stroke-width="8"/><text x="400" y="235" text-anchor="middle" fill="#e8d5b4" font-size="42">${isUpdated ? "STAR CHART" : "OBSERVATORY"}</text></svg>`
  });
}

async function openParticipant(browser: Browser, displayName: string): Promise<ParticipantClient> {
  const context = await browser.newContext();
  await context.route("https://assets.example.test/**", fulfillHandoutImage);
  const page = await context.newPage();
  await page.goto(devLoginUrl(TEST_ROOM, displayName));
  await expect(page.getByRole("heading", { name: "Set the table before play" })).toBeVisible();
  await page.getByTestId("lobby-ready-toggle").click();
  await page.getByTestId("lobby-enter-room").click();
  await expect(page.getByRole("heading", { name: `Room: ${TEST_ROOM}` })).toBeVisible();
  return { context, page };
}

async function expectHandout(page: Page, title: string, imageUrl: string): Promise<void> {
  const spotlight = page.getByTestId("handout-spotlight");
  await expect(spotlight).toBeVisible();
  await expect(spotlight.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByTestId("handout-image")).toHaveAttribute("src", imageUrl);
  await expect(page.getByTestId("handout-image")).toBeVisible();
}

test("GM broadcasts, updates, and stops a handout across three clients with late-join sync", async ({ browser }) => {
  const gm = await openParticipant(browser, "GM");
  const alice = await openParticipant(browser, "Alice");
  let bob: ParticipantClient | undefined;

  try {
    await expect(gm.page.getByTestId("handout-control-panel")).toBeVisible();
    await expect(alice.page.getByTestId("handout-control-panel")).toHaveCount(0);

    await gm.page.getByLabel("Handout image URL").fill(FIRST_IMAGE_URL);
    await gm.page.getByLabel("Handout caption").fill("The ruined observatory");
    await gm.page.getByRole("button", { name: "Broadcast handout" }).click();

    await Promise.all([
      expectHandout(gm.page, "The ruined observatory", FIRST_IMAGE_URL),
      expectHandout(alice.page, "The ruined observatory", FIRST_IMAGE_URL)
    ]);
    await expect(alice.page.getByText("ADMIN PRESENTATION")).toBeVisible();

    await alice.page.getByRole("button", { name: "Minimize locally" }).click();
    await expect(alice.page.getByTestId("handout-spotlight-minimized")).toBeVisible();
    await expect(gm.page.getByTestId("handout-spotlight")).toBeVisible();

    await gm.page.getByLabel("Handout image URL").fill(UPDATED_IMAGE_URL);
    await gm.page.getByLabel("Handout caption").fill("The celestial lock");
    await gm.page.getByRole("button", { name: "Update handout" }).click();

    await expectHandout(gm.page, "The celestial lock", UPDATED_IMAGE_URL);
    await expect(alice.page.getByTestId("handout-spotlight-minimized")).toContainText("The celestial lock");

    bob = await openParticipant(browser, "Bob");
    await expect(bob.page.getByTestId("handout-control-panel")).toHaveCount(0);
    await expectHandout(bob.page, "The celestial lock", UPDATED_IMAGE_URL);

    await alice.page.getByTestId("handout-spotlight-minimized").click();
    await expectHandout(alice.page, "The celestial lock", UPDATED_IMAGE_URL);

    await gm.page.getByRole("button", { name: "End spotlight" }).click();
    await Promise.all(
      [gm.page, alice.page, bob.page].map(async (page) => {
        await expect(page.getByTestId("handout-spotlight")).toHaveCount(0);
        await expect(page.getByTestId("handout-spotlight-minimized")).toHaveCount(0);
      })
    );
  } finally {
    await Promise.all([gm.context.close(), alice.context.close(), bob?.context.close()]);
  }
});
