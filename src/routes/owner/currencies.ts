import { Elysia, t } from "elysia";
import { db } from "../../db";
import { currencies, currencyValueHistory } from "../../db/schema";
import { eq, desc } from "drizzle-orm";

// Common currencies with country name for the "Add currency" dropdown (owner-only)
const AVAILABLE_CURRENCIES = [
  { code: "USD", name: "US Dollar", countryName: "United States" },
  { code: "EUR", name: "Euro", countryName: "Eurozone" },
  { code: "GBP", name: "British Pound", countryName: "United Kingdom" },
  { code: "INR", name: "Indian Rupee", countryName: "India" },
  { code: "JPY", name: "Japanese Yen", countryName: "Japan" },
  { code: "AUD", name: "Australian Dollar", countryName: "Australia" },
  { code: "CAD", name: "Canadian Dollar", countryName: "Canada" },
  { code: "CHF", name: "Swiss Franc", countryName: "Switzerland" },
  { code: "CNY", name: "Chinese Yuan", countryName: "China" },
  { code: "HKD", name: "Hong Kong Dollar", countryName: "Hong Kong" },
  { code: "SGD", name: "Singapore Dollar", countryName: "Singapore" },
  { code: "AED", name: "UAE Dirham", countryName: "United Arab Emirates" },
  { code: "SAR", name: "Saudi Riyal", countryName: "Saudi Arabia" },
  { code: "PKR", name: "Pakistani Rupee", countryName: "Pakistan" },
  { code: "BHD", name: "Bahraini Dinar", countryName: "Bahrain" },
  { code: "KWD", name: "Kuwaiti Dinar", countryName: "Kuwait" },
  { code: "OMR", name: "Omani Rial", countryName: "Oman" },
  { code: "QAR", name: "Qatari Riyal", countryName: "Qatar" },
  { code: "EGP", name: "Egyptian Pound", countryName: "Egypt" },
  { code: "ZAR", name: "South African Rand", countryName: "South Africa" },
  { code: "BRL", name: "Brazilian Real", countryName: "Brazil" },
  { code: "MXN", name: "Mexican Peso", countryName: "Mexico" },
  { code: "RUB", name: "Russian Ruble", countryName: "Russia" },
  { code: "KRW", name: "South Korean Won", countryName: "South Korea" },
  { code: "THB", name: "Thai Baht", countryName: "Thailand" },
  { code: "MYR", name: "Malaysian Ringgit", countryName: "Malaysia" },
  { code: "IDR", name: "Indonesian Rupiah", countryName: "Indonesia" },
  { code: "PHP", name: "Philippine Peso", countryName: "Philippines" },
  { code: "TRY", name: "Turkish Lira", countryName: "Turkey" },
  { code: "NZD", name: "New Zealand Dollar", countryName: "New Zealand" },
].sort((a, b) => a.name.localeCompare(b.name));

export const currenciesRoutes = new Elysia({ prefix: "/currencies" })
  .guard({
    beforeHandle({ store, set }) {
      const role = (store as { role?: string }).role;
      if (role !== "owner") {
        set.status = 403;
        return { success: false, message: "Only owner can manage currencies" };
      }
    },
  })
  .get("/available", async ({ set }) => {
    set.status = 200;
    return { success: true, data: AVAILABLE_CURRENCIES };
  })
  .get("/", async ({ set }) => {
    try {
      const list = await db.select().from(currencies).orderBy(currencies.code);
      set.status = 200;
      return { success: true, data: list };
    } catch (err) {
      set.status = 500;
      return { success: false, error: "Failed to fetch currencies" };
    }
  })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const { code, name, countryName, value } = body;
        const [existing] = await db.select().from(currencies).where(eq(currencies.code, code)).limit(1);
        if (existing) {
          set.status = 409;
          return { success: false, message: "Currency already added" };
        }
        const [created] = await db
          .insert(currencies)
          .values({
            code,
            name,
            countryName,
            value: String(value ?? "1"),
          })
          .returning();
        set.status = 201;
        return { success: true, data: created };
      } catch (err) {
        set.status = 500;
        return { success: false, error: "Failed to add currency" };
      }
    },
    {
      body: t.Object({
        code: t.String(),
        name: t.String(),
        countryName: t.String(),
        value: t.Union([t.String(), t.Number()]),
      }),
    }
  )
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const id = Number(params.id);
        const newValue = body.value != null ? String(body.value) : undefined;
        if (newValue == null) {
          set.status = 400;
          return { success: false, message: "value is required" };
        }
        const [row] = await db.select().from(currencies).where(eq(currencies.id, id)).limit(1);
        if (!row) {
          set.status = 404;
          return { success: false, message: "Currency not found" };
        }
        await db.insert(currencyValueHistory).values({
          currencyId: id,
          value: row.value,
        });
        await db.update(currencies).set({ value: newValue }).where(eq(currencies.id, id));
        const [updated] = await db.select().from(currencies).where(eq(currencies.id, id)).limit(1);
        set.status = 200;
        return { success: true, data: updated };
      } catch (err) {
        set.status = 500;
        return { success: false, error: "Failed to update currency" };
      }
    },
    {
      body: t.Object({
        value: t.Union([t.String(), t.Number()]),
      }),
    }
  )
  .get("/:id/history", async ({ params, set }) => {
    try {
      const id = Number(params.id);
      const list = await db
        .select()
        .from(currencyValueHistory)
        .where(eq(currencyValueHistory.currencyId, id))
        .orderBy(desc(currencyValueHistory.createdAt));
      set.status = 200;
      return { success: true, data: list };
    } catch (err) {
      set.status = 500;
      return { success: false, error: "Failed to fetch history" };
    }
  });
