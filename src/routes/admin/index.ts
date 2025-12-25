import { Elysia } from "elysia";
import { app_middleware } from "../../middleware/auth";

console.log("=== ADMIN ROUTES MODULE LOADING ===");

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .state({ id: 0, role: "" })
  .guard({
    beforeHandle({ cookie, set, store }) {
      console.log("=== ADMIN GUARD DEBUG ===");
      console.log("Guard cookie:", cookie ? "exists" : "missing");
      console.log("About to call app_middleware with allowed: ['admin']");

      const state_result = app_middleware({
        cookie,
        allowed: ["admin"],
      });

      console.log("Guard result:", state_result);

      set.status = state_result.code;
      if (!state_result.data) return state_result;

      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
  })
  .get("/test", () => {
    console.log("=== ADMIN TEST ENDPOINT CALLED ===");
    return { message: "Admin test endpoint works!" };
  })
  .get("/", () => {
    console.log("=== ADMIN ROOT ENDPOINT CALLED ===");
    return { message: "Admin root endpoint works!" };
  });
