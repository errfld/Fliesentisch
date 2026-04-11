import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";

const TEST_ROOM = process.env.E2E_ROOM ?? "dnd-table-1";
const E2E_EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? "example.com";

function devLoginUrl(room: string, displayName: string): string {
  const encodedRoom = encodeURIComponent(room);
  const next = `/room/${encodedRoom}?name=${encodeURIComponent(displayName)}`;
  const emailLocalPart = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  const email = `${emailLocalPart || "player"}@${E2E_EMAIL_DOMAIN}`;
  const params = new URLSearchParams({
    email,
    name: displayName,
    next
  });
  return `/api/v1/auth/dev-login?${params.toString()}`;
}

type ParticipantClient = {
  context: BrowserContext;
  page: Page;
  identity: string;
};

async function openParticipant(browser: Browser, room: string, displayName: string): Promise<ParticipantClient> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(devLoginUrl(room, displayName));

  await expect(page.getByRole("heading", { name: `Room: ${room}` })).toBeVisible();
  const identityNode = page.locator("p:has-text('You are') span.font-mono");
  await expect(identityNode).toBeVisible();
  const identity = (await identityNode.textContent())?.trim();
  if (!identity) {
    throw new Error(`Failed to resolve identity for ${displayName}`);
  }

  return { context, page, identity };
}

async function ensureCameraOn(page: Page): Promise<void> {
  const cameraButton = page.getByRole("button", { name: /Camera (On|Off)/ });
  await expect(cameraButton).toBeVisible();
  const label = (await cameraButton.textContent())?.trim();
  if (label === "Camera On") {
    await cameraButton.click();
  }
  await expect(page.getByRole("button", { name: "Camera Off" })).toBeVisible();
}

async function waitForRemoteTile(page: Page, identity: string): Promise<void> {
  await expect(page.locator(`[data-testid^="video-tile-${identity}-"]`).first()).toBeVisible();
}

async function waitForVideoPlayback(page: Page, identity: string): Promise<void> {
  const video = page.locator(`[data-testid^="video-tile-${identity}-"] video`).first();
  await expect(video).toBeVisible();
  await expect
    .poll(async () =>
      video.evaluate((node) => {
        const element = node as HTMLVideoElement;
        return (
          element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          element.videoWidth > 0 &&
          element.videoHeight > 0 &&
          !element.paused
        );
      })
    )
    .toBe(true);
}

function localTile(page: Page, identity: string) {
  return page.locator(`[data-testid^="video-tile-${identity}-"]`).first();
}

async function clickVideoSelect(page: Page, identity: string): Promise<void> {
  await page.locator(`[data-testid^="video-select-${identity}-"]`).first().click();
}

async function whisperCardForMember(page: Page, memberIdentity: string) {
  return page.locator("li[data-testid^='whisper-card-']").filter({ hasText: memberIdentity }).first();
}

test.describe("whisper multi-client flows", () => {
  test("toggles mirrored self-view from the device panel and persists it on reload", async ({ browser }) => {
    const alice = await openParticipant(browser, TEST_ROOM, "Alice");

    try {
      await ensureCameraOn(alice.page);
      await waitForVideoPlayback(alice.page, alice.identity);

      const mirrorToggle = alice.page.getByTestId("mirror-self-view-toggle").getByRole("checkbox");
      const tile = localTile(alice.page, alice.identity);
      const video = tile.locator("video").first();

      await expect(mirrorToggle).not.toBeChecked();
      await expect(tile).toHaveAttribute("data-local-mirrored", "false");
      await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).style.transform)).toBe("");

      await mirrorToggle.check();

      await expect(mirrorToggle).toBeChecked();
      await expect(tile).toHaveAttribute("data-local-mirrored", "true");
      await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).style.transform)).toBe("scaleX(-1)");

      await alice.page.reload();
      await ensureCameraOn(alice.page);
      await waitForVideoPlayback(alice.page, alice.identity);

      const reloadedMirrorToggle = alice.page.getByTestId("mirror-self-view-toggle").getByRole("checkbox");
      const reloadedTile = localTile(alice.page, alice.identity);
      const reloadedVideo = reloadedTile.locator("video").first();

      await expect(reloadedMirrorToggle).toBeChecked();
      await expect(reloadedTile).toHaveAttribute("data-local-mirrored", "true");
      await expect.poll(() => reloadedVideo.evaluate((node) => (node as HTMLVideoElement).style.transform)).toBe("scaleX(-1)");
    } finally {
      await alice.context.close();
    }
  });

  test("renders live local and remote video in both sessions", async ({ browser }) => {
    const alice = await openParticipant(browser, TEST_ROOM, "Alice");
    const bob = await openParticipant(browser, TEST_ROOM, "Bob");

    try {
      await Promise.all([ensureCameraOn(alice.page), ensureCameraOn(bob.page)]);
      await Promise.all([
        waitForVideoPlayback(alice.page, alice.identity),
        waitForVideoPlayback(alice.page, bob.identity),
        waitForVideoPlayback(bob.page, alice.identity),
        waitForVideoPlayback(bob.page, bob.identity)
      ]);
    } finally {
      await alice.context.close();
      await bob.context.close();
    }
  });

  test("creates whisper with selected participant, supports V to talk, G to leave", async ({ browser }) => {
    const alice = await openParticipant(browser, TEST_ROOM, "Alice");
    const bob = await openParticipant(browser, TEST_ROOM, "Bob");

    try {
      await Promise.all([ensureCameraOn(alice.page), ensureCameraOn(bob.page)]);
      await waitForRemoteTile(alice.page, bob.identity);

      await clickVideoSelect(alice.page, bob.identity);
      await alice.page.getByRole("button", { name: "New Whisper" }).click();

      const aliceCard = await whisperCardForMember(alice.page, bob.identity);
      await expect(aliceCard).toContainText(alice.identity);

      const bobCard = await whisperCardForMember(bob.page, alice.identity);
      await expect(bobCard).toBeVisible();
      await bobCard.getByRole("button", { name: "Select" }).click();

      await bob.page.keyboard.down("v");
      await expect(bob.page.getByTestId("whisper-ptt-status")).toHaveText("PTT: active");
      await bob.page.keyboard.up("v");
      await expect(bob.page.getByTestId("whisper-ptt-status")).toHaveText("PTT: idle");

      await bob.page.keyboard.press("g");
      await expect(bob.page.getByText("No active whispers.")).toBeVisible();
      await expect(alice.page.getByText("No active whispers.")).toBeVisible();
    } finally {
      await alice.context.close();
      await bob.context.close();
    }
  });

  test("keeps each person in only one whisper when a new whisper is created", async ({ browser }) => {
    const alice = await openParticipant(browser, TEST_ROOM, "Alice");
    const bob = await openParticipant(browser, TEST_ROOM, "Bob");
    const carol = await openParticipant(browser, TEST_ROOM, "Carol");

    try {
      await Promise.all([ensureCameraOn(alice.page), ensureCameraOn(bob.page), ensureCameraOn(carol.page)]);
      await Promise.all([waitForRemoteTile(alice.page, bob.identity), waitForRemoteTile(alice.page, carol.identity)]);

      await clickVideoSelect(alice.page, bob.identity);
      await alice.page.getByRole("button", { name: "New Whisper" }).click();
      await expect(await whisperCardForMember(alice.page, bob.identity)).toContainText(alice.identity);

      await clickVideoSelect(alice.page, carol.identity);
      await alice.page.getByRole("button", { name: "New Whisper" }).click();

      const memberRows = alice.page.locator("p[data-testid^='whisper-members-']");
      await expect(memberRows).toHaveCount(1);
      await expect(memberRows.first()).toContainText(alice.identity);
      await expect(memberRows.first()).toContainText(carol.identity);
      await expect(memberRows.first()).not.toContainText(bob.identity);

      const bobViewOfWhisper = await whisperCardForMember(bob.page, alice.identity);
      await expect(bobViewOfWhisper).toContainText(carol.identity);
      await expect(bobViewOfWhisper.getByRole("button", { name: "Join" })).toBeVisible();

      await expect(await whisperCardForMember(carol.page, alice.identity)).toContainText(carol.identity);
    } finally {
      await alice.context.close();
      await bob.context.close();
      await carol.context.close();
    }
  });
});
