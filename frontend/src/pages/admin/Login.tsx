import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { DitherField } from "@/components/fx/DitherField";
import { SplitReveal } from "@/components/fx/motion";
import { Arrow, Button, ErrorNote, Logo, Spinner } from "@/components/ui/kit";
import { USE_MOCKS } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { DEMO_PASSWORD, users } from "@/mocks/store";

export default function Login() {
  const { user, checking, login } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(".login-field", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, duration: 0.9, delay: 0.3 });
    },
    { scope: form },
  );

  if (!checking && user) return <Navigate to={homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      nav(from && from !== "/admin/login" ? from : homeFor(u), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      if (!prefersReducedMotion()) gsap.fromTo(form.current, { x: -8 }, { x: 0, duration: 0.6, ease: "elastic.out(1, 0.3)" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[100svh] bg-ink text-bone lg:grid-cols-[1.1fr_1fr]">
      <section className="grain relative hidden overflow-hidden lg:block">
        <DitherField
          cell={6}
          palette={["#16104f", "#3b2bff", "#8a7fff", "#e4e0ff"]}
          sources={[{ x: 0.3, y: 0.62, strength: 1.1 }]}
          orbs={[{ x: 0.3, y: 0.62, r: 0.16 }]}
          floor={0.25}
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <Logo />
          <div>
            <SplitReveal as="h1" className="display text-[clamp(3.5rem,6.5vw,6.5rem)]">
              Every issue,
              <br />
              <span className="serif-accent text-lilac">with its receipts.</span>
            </SplitReveal>
            <p className="mt-6 max-w-md text-bone/60">
              The staff console: prioritised issues, the evidence behind every label, and a public answer for every fix.
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden">
            <Logo />
          </span>
          <Link to="/" className="text-sm text-bone/50 hover:text-bone">
            ← Back to Echo
          </Link>
        </div>

        <form ref={form} onSubmit={submit} noValidate className="mx-auto my-auto w-full max-w-sm py-16">
          <p className="login-field eyebrow mb-3 text-lilac">Staff console</p>
          <h2 className="login-field display text-5xl">Sign in</h2>

          <label className="login-field mt-10 block">
            <span className="mb-2 block text-sm text-bone/60">Email</span>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-13 w-full rounded-2xl bg-ink-2 px-4 text-lg outline-none ring-1 ring-bone/10 transition focus:ring-2 focus:ring-lilac"
            />
          </label>
          <label className="login-field mt-4 block">
            <span className="mb-2 block text-sm text-bone/60">Password</span>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-13 w-full rounded-2xl bg-ink-2 px-4 text-lg outline-none ring-1 ring-bone/10 transition focus:ring-2 focus:ring-lilac"
            />
          </label>

          {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

          <Button type="submit" size="lg" className="login-field mt-6 w-full" disabled={busy} icon={busy ? undefined : <Arrow />}>
            {busy ? <Spinner /> : "Sign in"}
          </Button>

          {USE_MOCKS && (
            <div className="login-field mt-10 border-t border-bone/10 pt-6">
              <p className="eyebrow mb-3 text-bone/40">Demo accounts · mock mode</p>
              <div className="flex flex-wrap gap-2">
                {users.slice(0, 3).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setEmail(u.email);
                      setPassword(DEMO_PASSWORD);
                      setError(null);
                    }}
                    className="rounded-full bg-bone/[0.06] px-3.5 py-2 text-sm text-bone/75 ring-1 ring-bone/10 hover:bg-bone/10 hover:text-bone"
                  >
                    {u.name}
                    <span className="ml-1.5 text-bone/35">{u.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
