import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, Phone, ShieldCheck, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

interface Props {
  reservationId: string;
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}

interface SendResp {
  id: string;
  channel: "sms" | "email";
  target: string;
  expiresInSeconds: number;
  devCode?: string;
}

export function OtpModal({ reservationId, open, onClose, onVerified }: Props) {
  const [step, setStep] = useState<"choose" | "verify">("choose");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [send, setSend] = useState<SendResp | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setStep("choose");
      setSend(null);
      setCode("");
      setError(null);
      setSecondsLeft(0);
    }
  }, [open]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  async function onSend() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<SendResp>("/otp/send", { reservationId, channel });
      setSend(r);
      setSecondsLeft(r.expiresInSeconds);
      setStep("verify");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (code.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/otp/verify", { reservationId, code });
      onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-brand-dark/40 p-4">
      <div ref={dialogRef} className="w-full max-w-md bg-surface rounded-md shadow-xl border border-borderc">
        <div className="flex items-center justify-between px-5 py-3 border-b border-borderc">
          <div className="flex items-center gap-2 font-semibold text-textPrimary">
            <ShieldCheck className="w-5 h-5 text-brand" />
            Verify guest
          </div>
          <button onClick={onClose} className="text-textSecondary hover:text-textPrimary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === "choose" && (
            <>
              <p className="text-sm text-textSecondary">
                Send a one-time code to the guest to confirm their identity at check-in.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setChannel("sms")}
                  className={`flex items-center gap-2 justify-center py-3 rounded-md border-2 transition-colors ${
                    channel === "sms" ? "border-brand bg-brand-soft text-brand-dark" : "border-borderc text-textSecondary hover:border-brand/40"
                  }`}
                >
                  <Phone className="w-4 h-4" /> SMS
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  className={`flex items-center gap-2 justify-center py-3 rounded-md border-2 transition-colors ${
                    channel === "email" ? "border-brand bg-brand-soft text-brand-dark" : "border-borderc text-textSecondary hover:border-brand/40"
                  }`}
                >
                  <Mail className="w-4 h-4" /> Email
                </button>
              </div>
              {error && <div className="text-danger text-sm">{error}</div>}
              <button
                type="button"
                onClick={onSend}
                disabled={busy}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Send code
              </button>
            </>
          )}

          {step === "verify" && send && (
            <>
              <p className="text-sm text-textSecondary">
                Code sent to <strong className="text-textPrimary">{send.target}</strong>. Ask the guest to read it back.
              </p>
              {send.devCode && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                  Dev mode: code is <strong className="font-mono">{send.devCode}</strong>
                </div>
              )}
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className="input text-center text-2xl tracking-[0.5em] font-mono"
                placeholder="000000"
                inputMode="numeric"
              />
              <div className="flex items-center justify-between text-xs text-textSecondary">
                <span>{secondsLeft > 0 ? `Expires in ${mins}:${secs}` : "Code expired"}</span>
                <button
                  type="button"
                  onClick={() => {
                    setStep("choose");
                    setCode("");
                  }}
                  className="text-brand hover:underline"
                >
                  Resend / change channel
                </button>
              </div>
              {error && <div className="text-danger text-sm">{error}</div>}
              <button
                type="button"
                onClick={onVerify}
                disabled={busy || code.length < 4 || secondsLeft <= 0}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Verify &amp; continue
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
