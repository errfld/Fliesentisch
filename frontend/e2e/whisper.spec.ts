import { Browser, BrowserContext, expect, Page, test } from "@playwright/test";

const TEST_ROOM = process.env.E2E_ROOM ?? "dnd-table-1";

type ParticipantClient = {
  context: BrowserContext;
  page: Page;
  identity: string;
};

async function openParticipant(browser: Browser, room: string, displayName: string): Promise<ParticipantClient> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/room/${room}?name=${encodeURIComponent(displayName)}`);

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
  await expect(page.getByTestId(`video-tile-${identity}`)).toBeVisible();
}

async function whisperCardForMember(page: Page, memberIdentity: string) {
  return page.locator("li[data-testid^='whisper-card-']").filter({ hasText: memberIdentity }).first();
}

test.describe("whisper multi-client flows", () => {
  test("creates whisper with selected participant, supports V to talk, G to leave", async ({ browser }) => {
    const alice = await openParticipant(browser, TEST_ROOM, "Alice");
    const bob = await openParticipant(browser, TEST_ROOM, "Bob");

    try {
      await Promise.all([ensureCameraOn(alice.page), ensureCameraOn(bob.page)]);
      await waitForRemoteTile(alice.page, bob.identity);

      await alice.page.getByTestId(`video-select-${bob.identity}`).click();
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

      await alice.page.getByTestId(`video-select-${bob.identity}`).click();
      await alice.page.getByRole("button", { name: "New Whisper" }).click();
      await expect(await whisperCardForMember(alice.page, bob.identity)).toContainText(alice.identity);

      await alice.page.getByTestId(`video-select-${carol.identity}`).click();
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
