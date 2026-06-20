import geoip from "geoip-lite";

export interface GeoInfo {
  country: string | null;
  city: string | null;
  timezone: string | null;
}

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
];

const isPrivateIp = (ip: string) => PRIVATE_RANGES.some((re) => re.test(ip));

const stripIPv6Prefix = (ip: string) =>
  ip.startsWith("::ffff:") ? ip.slice(7) : ip;

export const lookupGeo = (ip: string | null | undefined): GeoInfo => {
  if (!ip) return { country: null, city: null, timezone: null };
  const cleanIp = stripIPv6Prefix(ip.trim());
  if (!cleanIp || isPrivateIp(cleanIp)) {
    return { country: null, city: null, timezone: null };
  }
  try {
    const result = geoip.lookup(cleanIp);
    if (!result) return { country: null, city: null, timezone: null };
    return {
      country: result.country || null,
      city: result.city || null,
      timezone: result.timezone || null,
    };
  } catch {
    return { country: null, city: null, timezone: null };
  }
};
