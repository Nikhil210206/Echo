import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { ScrollTrigger } from "@/lib/gsap";
import { AuthProvider, RequireAuth } from "@/lib/auth";
import Landing from "@/pages/Landing";
import { Spinner } from "@/components/ui/kit";

const Report = lazy(() => import("@/pages/public/Report"));
const Submit = lazy(() => import("@/pages/public/Submit"));
const Track = lazy(() => import("@/pages/public/Track"));
const Transparency = lazy(() => import("@/pages/public/Transparency"));
const Placeholder = lazy(() => import("@/pages/Placeholder"));

const Login = lazy(() => import("@/pages/admin/Login"));
const AdminShell = lazy(() => import("@/components/admin/AdminShell").then((m) => ({ default: m.AdminShell })));
const Dashboard = lazy(() => import("@/pages/admin/Dashboard"));
const Issues = lazy(() => import("@/pages/admin/Issues"));
const IssueDetail = lazy(() => import("@/pages/admin/IssueDetail"));
const Feedback = lazy(() => import("@/pages/admin/Feedback"));
const Moderation = lazy(() => import("@/pages/admin/Moderation"));
const QRCodes = lazy(() => import("@/pages/admin/QRCodes"));

/** Reset scroll on navigation, honour #hash links, and re-measure scroll triggers. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      requestAnimationFrame(() => document.querySelector(hash)?.scrollIntoView({ behavior: "smooth" }));
    } else {
      window.scrollTo(0, 0);
    }
    const id = setTimeout(() => ScrollTrigger.refresh(), 300);
    return () => clearTimeout(id);
  }, [pathname, hash]);
  return null;
}

function Fallback() {
  return (
    <div className="grid min-h-[100svh] place-items-center bg-ink text-lilac">
      <Spinner className="h-6" />
    </div>
  );
}

const adminOnly = (el: ReactNode) => <RequireAuth roles={["admin"]}>{el}</RequireAuth>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollManager />
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/report" element={<Report />} />
            <Route path="/q/:slug" element={<Submit />} />
            <Route path="/track" element={<Track />} />
            <Route path="/track/:code" element={<Track />} />
            <Route path="/transparency" element={<Transparency />} />

            <Route path="/admin/login" element={<Login />} />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <AdminShell />
                </RequireAuth>
              }
            >
              <Route index element={adminOnly(<Dashboard />)} />
              <Route path="issues" element={<Issues />} />
              <Route path="issues/:id" element={<IssueDetail />} />
              <Route path="feedback" element={adminOnly(<Feedback />)} />
              <Route path="moderation" element={adminOnly(<Moderation />)} />
              <Route path="qr" element={adminOnly(<QRCodes />)} />
            </Route>

            <Route path="*" element={<Placeholder title="Nothing here" notFound />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
