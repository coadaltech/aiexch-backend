import { db } from "@db/index";
import { whitelabels } from "@db/schema";
import { generateDatabaseClient } from "@utils/db-utils";
import { eq } from "drizzle-orm";

export const whitelabel_middleware = async (request: Request) => {
  const host = request.headers.get("x-whitelabel-domain") ?? "";
  if (!host) {
    return { db, whitelabel: undefined };
  }

  const whitelabel = await db.query.whitelabels.findFirst({
    where: eq(whitelabels.domain, host),
  });

  if (!whitelabel || !whitelabel.config) {
    return { db, whitelabel: undefined };
  }

  try {
    const configs = JSON.parse(whitelabel.config);
    const clientDb = generateDatabaseClient(configs.dbName);
    return {
      db: clientDb,
      whitelabel: { ...whitelabel, config: whitelabel.config ?? undefined },
    };
  } catch (err) {
    console.error("Failed to parse whitelabel config:", err);
    return { db, whitelabel: undefined };
  }
};
