import { Elysia } from "elysia";
import { app_middleware } from "../../middleware/auth";

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .state({ id: 0, role: "" })
  .guard({
    beforeHandle({ cookie, set, store }) {
      const state_result = app_middleware({
        cookie,
        allowed: ["admin"],
      });

      set.status = state_result.code;
      if (!state_result.data) return state_result;

      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
  })
  .get("/test", () => {
    return { message: "Admin test endpoint works!" };
  })
  .get("/", () => {
    return { message: "Admin root endpoint works!" };
  });
