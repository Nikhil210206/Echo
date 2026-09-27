import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, getToken, setToken } from "./api";
import type { Role, User } from "./types";

interface AuthState {
  user: User | null;
  /** True until a stored session has been checked */
  checking: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!getToken());

  // Restore a session saved in this tab
  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    api
      .me()
      .then((u) => alive && setUser(u))
      .catch(() => {
        if (!alive) return;
        setToken(null);
        setUser(null);
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    setToken(r.access_token);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, checking, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}

/** Where each role lands after signing in */
export const homeFor = (u: User) => (u.role === "admin" ? "/admin" : "/admin/issues");

export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, checking } = useAuth();
  const loc = useLocation();
  if (checking) return null;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
