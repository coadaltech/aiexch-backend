import { Elysia } from "elysia";
import { promotionsRoutes } from "./promotions";
import { promocodesRoutes } from "./promocodes";
import { bannersRoutes } from "./banners";
import { popupsRoutes } from "./popups";
import { whitelabelsRoutes } from "./whitelabels";
import { transactionsRoutes } from "./transactions";
import { kycRoutes } from "./kyc";
import { usersRoutes } from "./users";
import { settingsRoutes } from "./settings";
import { notificationsRoutes } from "./notifications";
import { qrCodesRoutes } from "./qrcodes";
import { sportsGamesRoutes } from "./sports-games";
import { homeSectionsRoutes } from "./home-sections";
import { withdrawalMethodsRoutes } from "./withdrawal-methods";
import { domainsRoutes } from "./domains";
import { casinoGamesAdminRoutes } from "./casino-games";
import { app_middleware } from "../../middleware/auth";

export const adminRoutes = (app: Elysia) =>
  app.group("/admin", (admin) =>
    admin
      .state({ id: 0, role: "" })
      .guard({
        beforeHandle({ cookie, set, store }) {
          console.log(`ADMIN ROUTE ACCESS: Attempting to access admin routes`);
          console.log(
            `ADMIN ROUTE ACCESS: Checking authentication and authorization...`
          );

          const state_result = app_middleware({
            cookie,
            allowed: ["admin"],
          });

          console.log(
            `ADMIN ROUTE ACCESS: Middleware result - Success: ${state_result.success}, Code: ${state_result.code}`
          );

          if (!state_result.success) {
            console.log(`ADMIN ROUTE ACCESS DENIED: ${state_result.message}`);
            console.log(
              `ADMIN ROUTE ACCESS DENIED: User cannot access admin routes`
            );
          } else {
            console.log(
              `ADMIN ROUTE ACCESS GRANTED: Admin user authenticated successfully`
            );
            console.log(
              `ADMIN ROUTE ACCESS: User ID: ${state_result.data?.id}, Role: ${state_result.data?.role}`
            );
          }

          set.status = state_result.code;
          if (!state_result.data) return state_result;

          store.id = state_result.data.id;
          store.role = state_result.data.role;

          console.log(
            `ADMIN ROUTE ACCESS: User ${store.id} (role: ${store.role}) can now access admin endpoints`
          );
        },
      })
      .use(promotionsRoutes)
      .use(promocodesRoutes)
      .use(bannersRoutes)
      .use(popupsRoutes)
      .use(whitelabelsRoutes)
      .use(transactionsRoutes)
      .use(kycRoutes)
      .use(usersRoutes)
      .use(settingsRoutes)
      .use(notificationsRoutes)
      .use(qrCodesRoutes)
      .use(sportsGamesRoutes)
      .use(homeSectionsRoutes)
      .use(withdrawalMethodsRoutes)
      .use(domainsRoutes)
      .use(casinoGamesAdminRoutes)
  );
