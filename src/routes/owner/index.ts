import { Elysia } from "elysia";
import { app_middleware } from "../../middleware/auth";
import { bannersRoutes } from "./banners";
import { promocodesRoutes } from "./promocodes";
import { promotionsRoutes } from "./promotions";
import { usersRoutes } from "./users";
import { notificationsRoutes } from "./notifications";
import { popupsRoutes } from "./popups";
import { qrCodesRoutes } from "./qrcodes";
import { settingsRoutes } from "./settings";
import { sportsGamesRoutes } from "./sports-games";
import { homeSectionsRoutes } from "./home-sections";
import { kycRoutes } from "./kyc";
import { vouchersRoutes } from "./vouchers";
import { whitelabelsRoutes } from "./whitelabels";
import { withdrawalMethodsRoutes } from "./withdrawal-methods";
import { casinoGamesOwnerRoutes } from "./casino-games";
import { domainsRoutes } from "./domains";

export const ownerRoutes = new Elysia({ prefix: "/owner" })
  .state({ id: 0, role: "" })
  .guard({
    beforeHandle({ cookie, set, store }) {
      const state_result = app_middleware({
        cookie,
        allowed: ["owner", "admin", "super", "master", "agent"],
      });

      set.status = state_result.code;
      if (!state_result.data) return state_result;

      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
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
  .use(homeSectionsRoutes)
  .use(kycRoutes)
  .use(vouchersRoutes)
  .use(whitelabelsRoutes)
  .use(withdrawalMethodsRoutes)
  .use(casinoGamesOwnerRoutes)
// .use((app) => domainsRoutes(app));
