import { NextResponse } from "next/server";
import { openUsageStore, USAGE_RETENTION_KEYS } from "@openagenthub/runtime";

export async function GET(): Promise<Response> {
  const store = openUsageStore();
  try {
    const settings: Record<string, string> = {};
    for (const key of USAGE_RETENTION_KEYS) {
      const value = store.getSetting(key);
      if (value !== null) settings[key] = value;
    }
    return NextResponse.json(settings);
  } finally {
    store.close();
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const store = openUsageStore();
  try {
    for (const key of USAGE_RETENTION_KEYS) {
      const raw = body[key];
      if (raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ error: `${key} must be a non-negative integer` }, { status: 400 });
      }
      store.setSetting(key, String(n));
    }
    const settings: Record<string, string> = {};
    for (const key of USAGE_RETENTION_KEYS) {
      const value = store.getSetting(key);
      if (value !== null) settings[key] = value;
    }
    return NextResponse.json(settings);
  } finally {
    store.close();
  }
}
