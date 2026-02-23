import { db } from "@db/index";
import { whitelabels } from "@db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolves whitelabel by domain (x-whitelabel-domain header).
 * Always returns the main db - all whitelabels use the same database.
 * Filtering by whitelabel id is done in routes when needed.
 */
export const whitelabel_middleware = async (request: Request) => {
  const host = request.headers.get("x-whitelabel-domain") ?? "";
  if (!host) {
    return { db, whitelabel: undefined, dbError: undefined };
  }

  const whitelabel = await db.query.whitelabels.findFirst({
    where: eq(whitelabels.domain, host),
  });

  if (!whitelabel) {
    return { db, whitelabel: undefined, dbError: undefined };
  }

  return {
    db,
    whitelabel: { ...whitelabel, config: whitelabel.config ?? undefined },
    dbError: undefined,
  };
};
