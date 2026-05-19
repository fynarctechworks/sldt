import { useMutation, useQuery } from "@tanstack/react-query";
import { Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { inr } from "@/lib/utils";

interface Preview {
  reservationId: string;
  reservationNumber: string;
  reservationBalanceDue: number;
  walletBalance: number;
  walletCreditAlreadyApplied: number;
  maxRedeemable: number;
}

interface Props {
  reservationId: string;
  onClose: () => void;
  onApplied: () => void;
}

export function ApplyWalletCreditModal({ reservationId, onClose, onApplied }: Props) {
  const [amount, setAmount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const preview = useQuery({
    queryKey: ["wallet-credit-preview", reservationId],
    queryFn: () =>
      api.get<Preview>(`/reservations/${reservationId}/wallet-credit-preview`),
    retry: false,
  });

  // Pre-fill with the max redeemable once preview loads. Staff almost always
  // wants to apply as much as possible; they can lower it if they want to
  // keep some credit in reserve.
  useEffect(() => {
    if (preview.data && amount === 0) {
      setAmount(preview.data.maxRedeemable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data]);

  // One key per modal mount — double-click submits within the same modal
  // open are deduplicated server-side. Closing + reopening the modal
  // generates a fresh key.
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);

  const apply = useMutation({
    mutationFn: (amt: number) =>
      api.post(
        `/reservations/${reservationId}/apply-wallet-credit`,
        { amount: amt },
        { idempotencyKey },
      ),
    onSuccess: () => onApplied(),
    onError: (e: unknown) => {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed");
    },
  });

  const max = preview.data?.maxRedeemable ?? 0;
  const clampedAmount = Math.max(0, Math.min(max, amount));
  const remainingWallet = preview.data
    ? Math.max(0, +(preview.data.walletBalance - clampedAmount).toFixed(2))
    : 0;
  const remainingBill = preview.data
    ? Math.max(0, +(preview.data.reservationBalanceDue - clampedAmount).toFixed(2))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-dark/40 p-4">
      <div
        className="my-auto w-full max-w-md bg-white rounded-md shadow-xl border border-borderc"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-borderc bg-brand-soft">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-brand" />
            <div className="font-semibold text-brand-dark">Apply wallet credit</div>
          </div>
          <button onClick={onClose} className="text-textSecondary hover:text-textPrimary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 text-[13px] text-textPrimary space-y-3">
          {preview.isLoading && (
            <div className="text-textSecondary">Loading wallet balance…</div>
          )}

          {preview.isError && (
            <div className="p-2 rounded-sm bg-danger/10 text-danger text-[12px]">
              Could not load wallet info.
            </div>
          )}

          {preview.data && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-borderc rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
                    Wallet balance
                  </div>
                  <div className="font-mono text-lg font-bold text-brand-dark mt-0.5">
                    {inr(preview.data.walletBalance)}
                  </div>
                </div>
                <div className="border border-borderc rounded-sm p-3">
                  <div className="text-[10px] uppercase tracking-wider text-textSecondary font-semibold">
                    Reservation balance due
                  </div>
                  <div className="font-mono text-lg font-bold text-danger mt-0.5">
                    {inr(preview.data.reservationBalanceDue)}
                  </div>
                </div>
              </div>

              {preview.data.walletCreditAlreadyApplied > 0.009 && (
                <div className="text-[11px] text-textSecondary">
                  Already applied to this booking:{" "}
                  <span className="font-mono">
                    {inr(preview.data.walletCreditAlreadyApplied)}
                  </span>
                </div>
              )}

              {max <= 0.009 ? (
                <div className="p-2 rounded-sm bg-warning/10 text-warning text-[12px]">
                  Nothing to apply — either wallet is empty or this booking has no outstanding
                  balance.
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="label">Amount to apply (₹)</label>
                      <button
                        type="button"
                        onClick={() => setAmount(max)}
                        className="text-[11px] text-brand hover:underline"
                      >
                        Apply max ({inr(max)})
                      </button>
                    </div>
                    <input
                      type="number"
                      className="input"
                      min={0}
                      max={max}
                      step="0.01"
                      value={amount || ""}
                      onChange={(e) => setAmount(Number(e.target.value))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-sm bg-bg p-2">
                      <div className="text-textSecondary">After: wallet</div>
                      <div className="font-mono font-semibold">{inr(remainingWallet)}</div>
                    </div>
                    <div className="rounded-sm bg-bg p-2">
                      <div className="text-textSecondary">After: balance due</div>
                      <div className="font-mono font-semibold text-danger">
                        {inr(remainingBill)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {error && (
            <div className="p-2 rounded-sm bg-danger/10 text-danger text-[12px]">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-borderc bg-bg">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => apply.mutate(clampedAmount)}
            disabled={
              !preview.data ||
              max <= 0.009 ||
              clampedAmount <= 0.009 ||
              apply.isPending
            }
            className="btn-primary"
          >
            {apply.isPending ? "Applying…" : `Apply ${inr(clampedAmount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
