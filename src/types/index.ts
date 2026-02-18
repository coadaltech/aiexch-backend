import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Context } from "elysia";
import { db as mainDb } from "../db";

export type DbType = typeof mainDb;

declare module "elysia" {
  interface Context {
    db: PostgresJsDatabase<any>;
    whitelabel?: {
      id: number;
      domain: string;
      config?: string;
      [key: string]: any;
    };
  }
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  membership: string;
  status: string;
}

export interface Profile {
  id: number;
  userId: number;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  country?: string;
  city?: string;
  address?: string;
  phone?: string;
  avatar?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export const CALLBACK_ACTION = ["balance", "bet", "win", "refund"] as const;
export type CallbackAction = (typeof CALLBACK_ACTION)[number];

export type RoleType = "owner" | "admin" | "super" | "master" | "agent" | "user";

export type WhitelabelContext = Context;
