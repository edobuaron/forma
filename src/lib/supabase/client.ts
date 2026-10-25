"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (client) return client;
  const { url, anonKey } = supabaseEnv();
  client = createBrowserClient(url, anonKey);
  return client;
}
