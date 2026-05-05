import { useEffect, useId, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";

export default function Login() {
  const { signIn, session } = useAuth();
  const location = useLocation();
  const emailId = useId();
  const pwId = useId();
  const errId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ email?: boolean; pw?: boolean }>({});
  const [capsOn, setCapsOn] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("hd:lastEmail");
    if (saved) setEmail(saved);
  }, []);

  if (session) {
    const from =
      (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const pwValid = password.length >= 6;
  const formValid = emailValid && pwValid;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ email: true, pw: true });
    if (!formValid || busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      if (remember) localStorage.setItem("hd:lastEmail", email);
      else localStorage.removeItem("hd:lastEmail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-ivory">
      <aside className="hidden lg:flex relative overflow-hidden bg-brand-dark text-cream p-12 flex-col justify-between">
        <div className="absolute inset-0 opacity-[0.18] [background:radial-gradient(circle_at_18%_15%,#E8E2D3_0,transparent_45%),radial-gradient(circle_at_82%_85%,#B08A4A_0,transparent_55%)]" />
        <div className="absolute inset-y-0 right-0 w-px bg-brass/20" />
        <div className="relative flex items-center gap-3 font-semibold text-lg">
          <img src="/logo.jpg" alt="SLDT Stay Inn" className="w-14 h-14 rounded-xl object-contain bg-cream shadow-md ring-1 ring-brass/30" />
          <div className="leading-tight">
            <div className="text-cream">SLDT Stay Inn</div>
            <div className="text-[11px] font-normal text-brass tracking-wide">SABBAVARAM</div>
          </div>
        </div>

        <div className="relative space-y-5 max-w-md">
          <div className="inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] uppercase px-3 py-1 rounded-full bg-brass/15 text-brass ring-1 ring-brass/30">
            Front Office Suite
          </div>
          <h2 className="text-[2.2rem] font-semibold leading-[1.15] text-cream whitespace-nowrap">
            Welcome to your <span className="text-brass italic font-serif">front desk.</span>
          </h2>
          <p className="text-cream/70 text-sm leading-relaxed">
            Reservations, housekeeping, guest profiles and reports, all in one
            calm workspace, made for SLDT Stay Inn.
          </p>
          <ul className="space-y-3 text-sm text-cream/90 pt-3">
            <li className="flex items-center gap-3">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-brass/15 ring-1 ring-brass/40">
                <ShieldCheck className="w-3.5 h-3.5 text-brass" />
              </span>
              Role-based staff access
            </li>
            <li className="flex items-center gap-3">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-brass/15 ring-1 ring-brass/40">
                <ShieldCheck className="w-3.5 h-3.5 text-brass" />
              </span>
              Encrypted guest data &amp; KYC
            </li>
            <li className="flex items-center gap-3">
              <span className="grid place-items-center w-7 h-7 rounded-full bg-brass/15 ring-1 ring-brass/40">
                <ShieldCheck className="w-3.5 h-3.5 text-brass" />
              </span>
              Real-time housekeeping sync
            </li>
          </ul>
        </div>

        <div className="relative text-[11px] tracking-wider text-cream/40">
          © {new Date().getFullYear()} SLDT STAY INN · SABBAVARAM
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10 bg-ivory">
        <form
          onSubmit={onSubmit}
          noValidate
          className="w-full max-w-md p-9 space-y-5 bg-surface rounded-md border border-borderc shadow-[0_20px_50px_-20px_rgba(15,61,46,0.25)]"
          aria-describedby={error ? errId : undefined}
        >
          <div className="lg:hidden flex items-center gap-3 font-semibold text-navy">
            <img src="/logo.jpg" alt="SLDT Stay Inn" className="w-11 h-11 rounded-md object-contain bg-brand-soft p-0.5" />
            <div className="leading-tight">
              <div>SLDT Stay Inn</div>
              <div className="text-[11px] font-normal text-textSecondary">Sabbavaram</div>
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-semibold text-navy">Welcome back</h1>
            <p className="text-textSecondary text-sm mt-1">
              Sign in to continue to your workspace.
            </p>
          </div>

          {error && (
            <div
              id={errId}
              role="alert"
              className="flex items-start gap-2 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-danger text-sm"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor={emailId} className="label block mb-1">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textSecondary pointer-events-none" />
              <input
                id={emailId}
                className={`input pl-9 ${
                  touched.email && !emailValid ? "border-danger focus:border-danger focus:ring-danger/30" : ""
                }`}
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                placeholder="you@sldtstayinn.com"
                required
                autoComplete="username"
                autoFocus
                aria-invalid={touched.email && !emailValid}
              />
            </div>
            {touched.email && !emailValid && (
              <p className="text-danger text-xs mt-1">Enter a valid email address.</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={pwId} className="label">
                Password
              </label>
              <button
                type="button"
                className="text-xs text-accentBlue hover:underline"
                onClick={() => alert("Contact your administrator to reset your password.")}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textSecondary pointer-events-none" />
              <input
                id={pwId}
                className={`input pl-9 pr-10 ${
                  touched.pw && !pwValid ? "border-danger focus:border-danger focus:ring-danger/30" : ""
                }`}
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, pw: true }))}
                onKeyUp={(e) => setCapsOn(e.getModifierState && e.getModifierState("CapsLock"))}
                onKeyDown={(e) => setCapsOn(e.getModifierState && e.getModifierState("CapsLock"))}
                required
                minLength={6}
                autoComplete="current-password"
                aria-invalid={touched.pw && !pwValid}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-textSecondary hover:text-navy hover:bg-bg"
                aria-label={showPw ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="min-h-[1rem] mt-1 flex items-center gap-3 text-xs">
              {touched.pw && !pwValid && (
                <span className="text-danger">Minimum 6 characters.</span>
              )}
              {capsOn && (
                <span className="text-warning flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Caps Lock is on
                </span>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-textSecondary select-none cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 rounded-sm border-borderc text-navy focus:ring-accentBlue/40"
            />
            Remember my email
          </label>

          <button
            type="submit"
            className="btn-primary w-full flex items-center justify-center gap-2"
            disabled={busy || !formValid}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>

          <p className="text-center text-xs text-textSecondary">
            Trouble signing in? Contact your hotel administrator.
          </p>
        </form>
      </main>
    </div>
  );
}
