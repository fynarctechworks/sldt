import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { UI_PREVIEW } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import type { Role } from "@hoteldesk/shared";

interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  rbacRoleKey: string | null;
  isGodMode: boolean;
  permissions: string[];
}

interface AuthCtx {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  permissions: Set<string>;
  isGodMode: boolean;
  can: (key: string) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const FAKE_SESSION = { access_token: "ui-preview", user: { id: "preview" } } as unknown as Session;
const FAKE_PROFILE: Profile = {
  id: "preview",
  email: "admin@hoteldesk.local",
  fullName: "Preview Admin",
  role: "admin",
  rbacRoleKey: "admin",
  isGodMode: true,
  permissions: [],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(UI_PREVIEW ? FAKE_SESSION : null);
  const [profile, setProfile] = useState<Profile | null>(UI_PREVIEW ? FAKE_PROFILE : null);
  const [loading, setLoading] = useState(!UI_PREVIEW);

  useEffect(() => {
    if (UI_PREVIEW) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession((prev) => (prev?.user.id === data.session?.user.id ? prev : data.session));
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession((prev) => (prev?.user.id === s?.user.id ? prev : s));
      if (!s) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (UI_PREVIEW) return;
    if (!userId) return;
    if (profile?.id === userId) return;
    setLoading(true);
    api
      .get<{ profile: Profile }>("/auth/me")
      .then((r) => setProfile(r.profile))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [userId, profile?.id]);

  async function signIn(email: string, password: string) {
    if (UI_PREVIEW) return;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    if (UI_PREVIEW) {
      setSession(null);
      setProfile(null);
      return;
    }
    await supabase.auth.signOut();
  }

  const permissions = useMemo(
    () => new Set(profile?.permissions ?? []),
    [profile?.permissions],
  );
  const isGodMode = profile?.isGodMode ?? false;

  function can(key: string): boolean {
    if (isGodMode) return true;
    return permissions.has(key);
  }

  return (
    <Ctx.Provider
      value={{ session, profile, loading, permissions, isGodMode, can, signIn, signOut }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

export function usePermission(key: string): boolean {
  return useAuth().can(key);
}
