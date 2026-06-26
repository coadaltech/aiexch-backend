import { Elysia } from "elysia";
import { app_middleware } from "../../middleware/auth";
import { UserRole } from "../../types/enums";
import { bannersRoutes } from "./banners";
import { promocodesRoutes } from "./promocodes";
import { promotionsRoutes } from "./promotions";
import { usersRoutes } from "./users";
import { notificationsRoutes } from "./notifications";
import { popupsRoutes } from "./popups";
import { qrCodesRoutes } from "./qrcodes";
import { settingsRoutes } from "./settings";
import { sportsGamesRoutes } from "./sports-games";
import { casinoCategoriesRoutes } from "./casino-categories";
import { homeSectionsRoutes } from "./home-sections";
import { kycRoutes } from "./kyc";
import { vouchersRoutes } from "./vouchers";
import { whitelabelsRoutes } from "./whitelabels";
import { withdrawalMethodsRoutes } from "./withdrawal-methods";
import { currenciesRoutes } from "./currencies";
import { marketManagementRoutes } from "./market-management";
import { matkaOwnerRoutes } from "./matka";
import { jamboOwnerRoutes } from "./jambo";
import { bombayBazarOwnerRoutes } from "./bombay-bazar";
import { liveMarketsRoutes } from "./live-markets";
import { transactionManagementRoutes } from "./transaction-management";
import { ownerAccountStatementRoutes } from "./account-statement";
import { sportsResultRoutes } from "./sports-result";
import { staffRoutes } from "./staff";

export const ownerRoutes = new Elysia({ prefix: "/owner" })
  // Per-request user context via .resolve() (NOT .state(), which is module-shared
  // and would leak userId/userRole across concurrent admin requests). Subroutes
  // mounted via .use() inherit the resolved `userId` and `userRole`.
  .resolve(async ({ cookie, headers, status, request }) => {
    const state_result = await app_middleware({
      cookie,
      headers,
      request,
      allowed: [UserRole.Owner, UserRole.Admin, UserRole.Super, UserRole.Master, UserRole.Agent],
    });
    if (!state_result.data) {
      return status(state_result.code as 401 | 403 | 404 | 500, state_result);
    }
    return {
      userId: state_result.data.id,
      userRole: state_result.data.role,
    };
  })
  .use(bannersRoutes)
  .use(promocodesRoutes)
  .use(promotionsRoutes)
  .use(usersRoutes)
  .use(notificationsRoutes)
  .use(popupsRoutes)
  .use(qrCodesRoutes)
  .use(settingsRoutes)
  .use(sportsGamesRoutes)
  .use(casinoCategoriesRoutes)
  .use(homeSectionsRoutes)
  .use(kycRoutes)
  .use(vouchersRoutes)
  .use(whitelabelsRoutes)
  .use(withdrawalMethodsRoutes)
  .use(currenciesRoutes)
  .use(marketManagementRoutes)
  .use(matkaOwnerRoutes)
  .use(jamboOwnerRoutes)
  .use(bombayBazarOwnerRoutes)
  .use(liveMarketsRoutes)
  .use(transactionManagementRoutes)
  .use(ownerAccountStatementRoutes)
  .use(sportsResultRoutes)
  .use(staffRoutes)
