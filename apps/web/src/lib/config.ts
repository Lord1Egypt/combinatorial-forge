export interface ForgeConfig {
  adminToken: string | null;
  networkSalt: string;
  requireDistinctNetworks: boolean;
  siteUrl: string;
}

const MIN_ADMIN_TOKEN = 24;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ForgeConfig {
  const token = env.ADMIN_TOKEN?.trim();
  const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const flag = env.FORGE_REQUIRE_DISTINCT_NETWORKS?.trim().toLowerCase();
  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  return {
    adminToken: token && token.length >= MIN_ADMIN_TOKEN ? token : null,
    networkSalt: env.FORGE_NETWORK_SALT?.trim() || token || "forge-dev-only-salt",
    requireDistinctNetworks: flag ? flag === "true" || flag === "1" : production,
    siteUrl:
      env.NEXT_PUBLIC_SITE_URL?.trim() || (vercelUrl ? `https://${vercelUrl}` : "http://localhost:3000"),
  };
}
