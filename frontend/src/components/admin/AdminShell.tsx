import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/ui/kit";
import { api, USE_MOCKS } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { useLive } from "@/lib/live";
import { IconExit, IconPulse, IconQr, IconSearch, IconShield, IconStack } from "./icons";

/* ---- shared console state ---------------------------------------------- */

interface Console {
  pending: number;
  refreshPending: () => void;
}
const ConsoleCtx = createContext<Console>({ pending: 0, refreshPending: () => {} });
export const useConsole = () => useContext(ConsoleCtx);

const NAV = [
  { to: "/admin", label: "Dashboard", icon: IconPulse, admin: true, end: true },
  { to: "/admin/issues", label: "Issues", icon: IconStack, admin: false, end: false },
  { to: "/admin/feedback", label: "Feedback", icon: IconSearch, admin: true, end: false },
  { to: "/admin/moderation", label: "Moderation", icon: IconShield, admin: true, end: false, badge: true },
  { to: "/admin/qr", label: "QR codes", icon: IconQr, admin: true, end: false },
];

export function AdminShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);
  const isAdmin = user?.role === "admin";

  const refreshPending = useCallback(() => {
    if (!isAdmin) return;
    api
      .moderationQueue()
      .then((q) => setPending(q.length))
      .catch(() => {});
  }, [isAdmin]);

  useEffect(refreshPending, [refreshPending]);
  const live = useLive((e) => {
    if (e.type === "moderation" || e.type === "feedback") refreshPending();
  });

  // Each page slides in when the route changes
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      // clearProps: a leftover transform would trap position:fixed overlays inside <main>
      gsap.fromTo(main.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, clearProps: "transform" });
    },
    { dependencies: [loc.pathname], scope: main },
  );

  useEffect(() => setMenu(false), [loc.pathname]);

  if (!user) return null;
  const items = NAV.filter((n) => isAdmin || !n.admin).map((n) => (n.to === "/admin/issues" && !isAdmin ? { ...n, label: "My issues" } : n));

  const sidebar = (
    <>
      <div className="flex items-center gap-2 px-3 pb-8 pt-2">
        <LogoMark className="h-7 w-7 text-bone" />
        <span className="display-soft text-[1.45rem] leading-none">echo</span>
        <span className="eyebrow ml-auto rounded-full bg-bone/10 px-2 py-1 !text-[0.6rem] text-bone/60">{isAdmin ? "Admin" : "Staff"}</span>
      </div>
      <nav className="flex flex-col gap-1" aria-label="Console">
        {items.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "group flex h-11 items-center gap-3 rounded-full px-4 text-[0.95rem] transition-colors",
                isActive ? "bg-bone text-ink" : "text-bone/60 hover:bg-bone/[0.06] hover:text-bone",
              )
            }
          >
            <Icon className="shrink-0" />
            {label}
            {badge && pending > 0 && (
              <span className="ml-auto grid h-6 min-w-6 place-items-center rounded-full bg-signal px-1.5 font-mono text-xs font-medium text-ink">{pending}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-3 pt-8">
        <div className="flex items-center gap-2 px-4 text-xs text-bone/50">
          <span className={cn("h-2 w-2 rounded-full", live ? "bg-mint shadow-[0_0_10px_2px_rgba(143,240,174,.5)]" : "bg-bone/30")} />
          {live ? "Live" : "Reconnecting…"}
          {USE_MOCKS && <span className="ml-auto font-mono text-[0.65rem] text-bone/30">mock data</span>}
        </div>
        <div className="flex items-center gap-3 rounded-[1.25rem] bg-bone/[0.05] p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cobalt font-medium">{user.name[0]}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{user.name}</span>
            <span className="block truncate text-xs text-bone/45">{user.team ?? user.email}</span>
          </span>
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => {
              logout();
              nav("/admin/login");
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-bone/50 hover:bg-bone/10 hover:text-bone"
          >
            <IconExit />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <ConsoleCtx.Provider value={{ pending, refreshPending }}>
      <div className="min-h-[100svh] bg-ink text-bone lg:flex">
        {/* Desktop rail */}
        <aside className="sticky top-0 hidden h-[100svh] w-[16.5rem] shrink-0 flex-col p-4 lg:flex">
          <div className="flex h-full flex-col rounded-[1.75rem] bg-ink-2 p-3 ring-1 ring-bone/[0.06]">{sidebar}</div>
        </aside>

        {/* Mobile bar */}
        <div className="sticky top-0 z-40 flex items-center justify-between bg-ink/85 px-4 py-3 backdrop-blur-lg lg:hidden">
          <span className="flex items-center gap-2">
            <LogoMark className="h-6 w-6" />
            <span className="display-soft text-xl">echo</span>
          </span>
          <button
            type="button"
            className="relative rounded-full bg-bone/10 px-4 py-2 text-sm"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            Menu
            {pending > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-signal" />}
          </button>
        </div>
        {menu && (
          <div className="fixed inset-0 z-50 flex flex-col bg-ink p-4 lg:hidden">
            <button type="button" onClick={() => setMenu(false)} className="mb-4 self-end rounded-full bg-bone/10 px-4 py-2 text-sm">
              Close
            </button>
            <div className="flex flex-1 flex-col rounded-[1.75rem] bg-ink-2 p-3">{sidebar}</div>
          </div>
        )}

        <main ref={main} className="min-w-0 flex-1 px-4 pb-16 pt-4 sm:px-6 lg:py-8 lg:pr-8">
          <Outlet />
        </main>
      </div>
    </ConsoleCtx.Provider>
  );
}

/* ---- building blocks shared by console pages -------------------------- */

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow mb-3 text-lilac">{eyebrow}</p>
        <h1 className="display text-[clamp(2.6rem,5vw,4.6rem)]">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Panel({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-[1.75rem] bg-ink-2 p-5 ring-1 ring-bone/[0.06] sm:p-6", className)}>
      {(title || action) && (
        <div className="mb-5 flex items-center justify-between gap-3">
          {title && <h2 className="display-soft text-xl">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-bone/[0.06]", className)} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-[1.5rem] border border-dashed border-bone/15 px-6 py-14 text-center">
      <p className="display-soft text-2xl">{title}</p>
      {children && <p className="mt-2 max-w-sm text-sm text-bone/55">{children}</p>}
    </div>
  );
}
