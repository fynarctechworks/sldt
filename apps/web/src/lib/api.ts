import { UI_PREVIEW, mockGet, mockMutation } from "./mock-data";
import { supabase } from "./supabase";

const BASE = import.meta.env.VITE_API_URL as string;

async function authHeader(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 304) {
    throw new ApiError(304, "NOT_MODIFIED", "Unexpected 304. Disable ETag on server");
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } }) : {};
  if (!res.ok || json?.success === false) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? "UNKNOWN",
      json?.error?.message ?? `HTTP ${res.status}`,
      json?.error?.details,
    );
  }
  return json.data as T;
}

export const api = {
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    if (UI_PREVIEW) return mockGet<T>(path, params);
    const url = new URL(`${BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url, { headers: await authHeader() });
    return handle<T>(res);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    if (UI_PREVIEW) return mockMutation<T>(path);
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle<T>(res);
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    if (UI_PREVIEW) return mockMutation<T>(path);
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle<T>(res);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    if (UI_PREVIEW) return mockMutation<T>(path);
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handle<T>(res);
  },

  async del<T>(path: string): Promise<T> {
    if (UI_PREVIEW) return mockMutation<T>(path);
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: await authHeader(),
    });
    return handle<T>(res);
  },

  async upload<T>(path: string, form: FormData): Promise<T> {
    if (UI_PREVIEW) return mockMutation<T>(path);
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: await authHeader(),
      body: form,
    });
    return handle<T>(res);
  },
};

export async function getList<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<{ data: T[]; meta: { total: number; page: number; per_page: number } }> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers: await authHeader() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new ApiError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
  }
  return { data: json.data, meta: json.meta };
}
