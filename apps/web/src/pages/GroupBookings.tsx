// Group bookings — master block list + rooming list editor.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Users, X } from "lucide-react";
import { useState } from "react";
import { Can } from "@/auth/Can";
import { Loader } from "@/components/Loader";
import { useToast } from "@/components/Toast";
import { api, getList } from "@/lib/api";

interface GroupBlockRow {
  id: string;
  groupCode: string;
  groupName: string;
  blockStartDate: string;
  blockEndDate: string;
  status: string;
  roomsBlocked: number;
  roomsPickedUp: number;
}

interface RoomingRow {
  id: string;
  roomType: string | null;
  roomId: string | null;
  roomNumber: string | null;
  guestName: string | null;
  guestPhone: string | null;
  ratePerNight: string | null;
  numAdults: number;
  numChildren: number;
  status: string;
}

interface BlockDetail extends GroupBlockRow {
  groupName: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  cutoffDate: string | null;
  notes: string | null;
  roomingList: RoomingRow[];
}

const STATUS_STYLE: Record<string, string> = {
  tentative: "bg-bg text-textSecondary",
  confirmed: "bg-brand-dark text-cream",
  partial: "bg-brass/15 text-brand-dark",
  closed: "bg-success/15 text-success",
  cancelled: "bg-danger/15 text-danger line-through",
};

const ROOM_STATUS_STYLE: Record<string, string> = {
  pending: "bg-bg text-textSecondary",
  confirmed: "bg-brand-dark text-cream",
  no_show: "bg-warning/15 text-warning",
  released: "bg-bg text-textSecondary line-through",
  cancelled: "bg-danger/15 text-danger line-through",
};

export default function GroupBookingsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const listQuery = useQuery({
    queryKey: ["group-blocks"],
    queryFn: () => getList<GroupBlockRow>("/group-blocks", { per_page: 100 }),
    refetchInterval: 30_000,
  });
  const blocks = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Group Bookings</h1>
          <div className="text-xs text-textSecondary mt-0.5">
            {blocks.length} group block{blocks.length === 1 ? "" : "s"}
          </div>
        </div>
        <Can do="manage_groups">
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New group
          </button>
        </Can>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        <div className="card !p-0 overflow-hidden">
          {listQuery.isLoading ? (
            <Loader label="Loading…" />
          ) : blocks.length === 0 ? (
            <div className="p-8 text-center text-sm text-textSecondary">No group bookings yet.</div>
          ) : (
            <ul className="divide-y divide-borderc max-h-[75vh] overflow-y-auto">
              {blocks.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full text-left px-3 py-3 hover:bg-bg ${selectedId === b.id ? "bg-brand-soft/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-accentBlue">{b.groupCode}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[b.status]}`}>
                        {b.status}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-brand-dark truncate">{b.groupName}</div>
                    <div className="text-[11px] text-textSecondary mt-0.5">
                      {b.blockStartDate} → {b.blockEndDate} · {b.roomsPickedUp}/{b.roomsBlocked} rooms picked up
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {selectedId ? (
            <BlockDetailPanel
              blockId={selectedId}
              onChanged={() => {
                void qc.invalidateQueries({ queryKey: ["group-blocks"] });
                void qc.invalidateQueries({ queryKey: ["group-block", selectedId] });
              }}
            />
          ) : (
            <div className="card grid place-items-center min-h-[300px] text-sm text-textSecondary">
              <div className="text-center">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                Select a group block.
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewBlockModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            setSelectedId(id);
            void qc.invalidateQueries({ queryKey: ["group-blocks"] });
          }}
        />
      )}
    </div>
  );
}

function BlockDetailPanel({
  blockId,
  onChanged,
}: {
  blockId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["group-block", blockId],
    queryFn: () => api.get<BlockDetail>(`/group-blocks/${blockId}`),
  });
  const [showAddRow, setShowAddRow] = useState(false);

  const addRowMutation = useMutation({
    mutationFn: (row: {
      roomType: string;
      guestName?: string;
      guestPhone?: string;
      numAdults: number;
    }) => api.post(`/group-blocks/${blockId}/rooms`, row),
    onSuccess: () => {
      toast("Room added to list", "success");
      setShowAddRow(false);
      onChanged();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (isLoading || !data) return <Loader label="Loading…" />;

  return (
    <div className="card space-y-4">
      <header className="flex items-start justify-between gap-3 border-b border-borderc pb-3">
        <div>
          <div className="font-mono text-xs text-accentBlue">{data.groupCode}</div>
          <h2 className="text-lg font-bold text-brand-dark">{data.groupName}</h2>
          <div className="text-xs text-textSecondary mt-1">
            {data.blockStartDate} → {data.blockEndDate}
            {data.cutoffDate && <> · cutoff {data.cutoffDate}</>}
          </div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_STYLE[data.status]}`}>
          {data.status}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Field label="Contact" value={data.contactName} />
        <Field label="Phone" value={data.contactPhone} />
        <Field label="Email" value={data.contactEmail} />
      </div>

      <div className="border-t border-borderc pt-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-brand-dark">
            Rooming list ({data.roomingList.length})
          </h3>
          <Can do="manage_groups">
            <button
              onClick={() => setShowAddRow(true)}
              className="text-xs text-accentBlue hover:underline"
            >
              + Add row
            </button>
          </Can>
        </div>
        {data.roomingList.length === 0 ? (
          <div className="text-xs text-textSecondary py-3 text-center">
            No rooms in the rooming list yet.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-textSecondary text-left">
                <th className="px-2 py-1">Room</th>
                <th className="px-2 py-1">Guest</th>
                <th className="px-2 py-1">Phone</th>
                <th className="px-2 py-1">Pax</th>
                <th className="px-2 py-1">Rate</th>
                <th className="px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.roomingList.map((r) => (
                <tr key={r.id} className="border-t border-borderc/60">
                  <td className="px-2 py-1 font-mono">
                    {r.roomNumber ? `#${r.roomNumber}` : r.roomType ?? "—"}
                  </td>
                  <td className="px-2 py-1">{r.guestName ?? <span className="text-textSecondary/60">—</span>}</td>
                  <td className="px-2 py-1">{r.guestPhone ?? <span className="text-textSecondary/60">—</span>}</td>
                  <td className="px-2 py-1">
                    {r.numAdults}A
                    {r.numChildren > 0 ? ` + ${r.numChildren}C` : ""}
                  </td>
                  <td className="px-2 py-1">
                    {r.ratePerNight ? `₹${Number(r.ratePerNight).toFixed(2)}` : <span className="text-textSecondary/60">—</span>}
                  </td>
                  <td className="px-2 py-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROOM_STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.notes && (
        <div className="text-xs border-t border-borderc pt-3">
          <div className="text-textSecondary">Notes</div>
          <div className="whitespace-pre-wrap">{data.notes}</div>
        </div>
      )}

      {showAddRow && (
        <AddRowModal onClose={() => setShowAddRow(false)} onAdd={(row) => addRowMutation.mutate(row)} />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-textSecondary">{label}</div>
      <div className="text-sm text-brand-dark">{value || <span className="text-textSecondary/60">—</span>}</div>
    </div>
  );
}

function NewBlockModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    groupCode: "",
    groupName: "",
    contactName: "",
    contactPhone: "",
    blockStartDate: format(new Date(), "yyyy-MM-dd"),
    blockEndDate: format(new Date(Date.now() + 86400000 * 2), "yyyy-MM-dd"),
    cutoffDate: "",
    notes: "",
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/group-blocks", {
        groupCode: form.groupCode.toUpperCase(),
        groupName: form.groupName,
        contactName: form.contactName || null,
        contactPhone: form.contactPhone || null,
        blockStartDate: form.blockStartDate,
        blockEndDate: form.blockEndDate,
        cutoffDate: form.cutoffDate || null,
        notes: form.notes || null,
      }),
    onSuccess: (row) => onCreated(row.id),
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h2 className="font-semibold text-brand-dark">New group block</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Group code</label>
              <input
                value={form.groupCode}
                onChange={(e) => setForm({ ...form, groupCode: e.target.value.toUpperCase() })}
                className="input mt-1 w-full"
                placeholder="SHARMA-WEDDING"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-textSecondary">Group name</label>
              <input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                className="input mt-1 w-full"
                placeholder="Sharma Family Wedding"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Contact</label>
              <input
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Phone</label>
              <input
                value={form.contactPhone}
                onChange={(e) =>
                  setForm({ ...form, contactPhone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                }
                className="input mt-1 w-full"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="9876543210"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Start date</label>
              <input
                type="date"
                value={form.blockStartDate}
                onChange={(e) => setForm({ ...form, blockStartDate: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">End date</label>
              <input
                type="date"
                value={form.blockEndDate}
                onChange={(e) => setForm({ ...form, blockEndDate: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Cutoff (optional)</label>
              <input
                type="date"
                value={form.cutoffDate}
                onChange={(e) => setForm({ ...form, cutoffDate: e.target.value })}
                className="input mt-1 w-full"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="input mt-1 w-full"
            />
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={
              form.groupCode.length < 3 || form.groupName.length < 2 || createMutation.isPending
            }
            onClick={() => createMutation.mutate()}
            className="btn-primary"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AddRowModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (row: { roomType: string; guestName?: string; guestPhone?: string; numAdults: number }) => void;
}) {
  const [roomType, setRoomType] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [numAdults, setNumAdults] = useState("2");

  const roomTypesQuery = useQuery({
    queryKey: ["room-types-list"],
    queryFn: () => api.get<{ slug: string; label: string }[]>("/settings/room-types"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-brand-dark/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md border border-borderc w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-borderc">
          <h3 className="font-semibold text-brand-dark text-sm">Add row to rooming list</h3>
          <button onClick={onClose} className="p-1 hover:bg-bg rounded">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-textSecondary">Room type</label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="input mt-1 w-full"
            >
              <option value="">— pick a type —</option>
              {(roomTypesQuery.data ?? []).map((rt) => (
                <option key={rt.slug} value={rt.slug}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-textSecondary">Guest name (optional)</label>
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-textSecondary">Phone (optional)</label>
              <input
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-textSecondary">Adults</label>
            <input
              type="number"
              min="1"
              max="10"
              value={numAdults}
              onChange={(e) => setNumAdults(e.target.value)}
              className="input mt-1 w-24"
            />
          </div>
        </div>
        <footer className="flex justify-end gap-2 px-4 py-3 border-t border-borderc">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            disabled={!roomType}
            onClick={() =>
              onAdd({
                roomType,
                guestName: guestName || undefined,
                guestPhone: guestPhone || undefined,
                numAdults: Number(numAdults || 1),
              })
            }
            className="btn-primary"
          >
            Add
          </button>
        </footer>
      </div>
    </div>
  );
}
