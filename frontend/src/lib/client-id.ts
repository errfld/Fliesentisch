const STORAGE_KEY = "virtual-table-client-id";

function bytesToUuid(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fallbackUuid(): string {
  const webCrypto =
    typeof window !== "undefined" && "crypto" in window ? window.crypto : undefined;
  const bytes = new Uint8Array(16);

  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
    return bytesToUuid(bytes);
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytesToUuid(bytes);
}

export function createUuid(): string {
  const webCrypto =
    typeof window !== "undefined" && "crypto" in window ? window.crypto : undefined;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  return fallbackUuid();
}

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = createUuid();
  window.localStorage.setItem(STORAGE_KEY, created);
  return created;
}

export function toIdentity(displayName: string, clientId: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  const normalizedClientId = clientId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const entropySuffix = normalizedClientId.slice(-12) || "000000000000";
  return `${slug || "player"}-${entropySuffix}`;
}
