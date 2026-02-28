import { UAParser } from "ua-parser-js";

export interface ParsedUA {
  userAgent: string;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  deviceBrand: string | null;
  deviceModel: string | null;
}

export function parseUserAgent(uaString: string | null | undefined): ParsedUA {
  if (!uaString) {
    return {
      userAgent: "",
      browser: null,
      browserVersion: null,
      os: null,
      osVersion: null,
      deviceType: "unknown",
      deviceBrand: null,
      deviceModel: null,
    };
  }

  const parser = new UAParser(uaString);
  const result = parser.getResult();

  const rawType = result.device.type;
  let deviceType: ParsedUA["deviceType"] = "desktop";
  if (rawType === "mobile") deviceType = "mobile";
  else if (rawType === "tablet") deviceType = "tablet";
  else if (!rawType) deviceType = "desktop";
  else deviceType = "unknown";

  return {
    userAgent: uaString,
    browser: result.browser.name ?? null,
    browserVersion: result.browser.version ?? null,
    os: result.os.name ?? null,
    osVersion: result.os.version ?? null,
    deviceType,
    deviceBrand: result.device.vendor ?? null,
    deviceModel: result.device.model ?? null,
  };
}
