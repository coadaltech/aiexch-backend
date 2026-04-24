/**
 * Dynamic CORS origins store.
 *
 * - Seeded with static (hardcoded) origins.
 * - Whitelabel domains are added at startup (loaded from DB) and at runtime
 *   (when a whitelabel is created or its domain is updated).
 * - Kept in a separate module to avoid circular imports between index.ts and routes.
 */
export const dynamicOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://10.42.0.1:3000",
  "http://10.42.0.1:3001",
  "http://10.42.0.1:3002",
  "http://10.42.0.1:3003",
  "https://aiexch-two.vercel.app",
  "https://aiexch.com",
  "https://www.aiexch.com",
  "https://www.webroom.ai",
]);

/**
 * Add a whitelabel domain to the live CORS allow-list.
 * Accepts bare domains ("example.com") or full URLs ("https://example.com").
 * Both https:// and http:// variants are added.
 */
export function addAllowedOrigin(domain: string) {
  if (!domain) return;
  const bare = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  dynamicOrigins.add(`https://${bare}`);
  dynamicOrigins.add(`http://${bare}`);
  console.log(`[CORS] Added origin: https://${bare}`);

  // Also add www variant if not already prefixed with www
  if (!bare.startsWith("www.")) {
    dynamicOrigins.add(`https://www.${bare}`);
    dynamicOrigins.add(`http://www.${bare}`);
    console.log(`[CORS] Added origin: https://www.${bare}`);
  }
}

/**
 * Remove a whitelabel domain from the live CORS allow-list.
 * Call this when a whitelabel domain is updated (remove old) or deleted.
 */
export function removeAllowedOrigin(domain: string) {
  if (!domain) return;
  const bare = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  dynamicOrigins.delete(`https://${bare}`);
  dynamicOrigins.delete(`http://${bare}`);
  console.log(`[CORS] Removed origin: https://${bare}`);

  if (!bare.startsWith("www.")) {
    dynamicOrigins.delete(`https://www.${bare}`);
    dynamicOrigins.delete(`http://www.${bare}`);
  }
}
