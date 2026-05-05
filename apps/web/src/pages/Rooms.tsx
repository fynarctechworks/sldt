import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Snowflake, Tv, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { Loader } from "@/components/Loader";
import { StatusBadge } from "@/components/StatusBadge";
import { useRoomTypes, labelForRoomType } from "@/hooks/useRoomTypes";
import { api } from "@/lib/api";
import { inr } from "@/lib/utils";

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  baseRate: string;
  maxOccupancy: number;
  hasAc: boolean;
  hasTv: boolean;
  hasWifi: boolean;
  status: string;
  notes: string | null;
}

export default function Rooms() {
  const { profile } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [floor, setFloor] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [type, setType] = useState<string>("");
  const { data: roomTypes = [] } = useRoomTypes({ includeArchived: true });

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["rooms", { floor, status, type }],
    queryFn: () =>
      api.get<Room[]>("/rooms", {
        floor: floor || undefined,
        status: status || undefined,
        type: type || undefined,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Rooms</h1>
        {profile?.role === "admin" && (
          <button onClick={() => setShowAdd(true)} className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Room
          </button>
        )}
      </div>

      <div className="card flex flex-wrap gap-3">
        <div>
          <label className="label block mb-1">Floor</label>
          <input
            className="input w-24"
            type="number"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="All"
          />
        </div>
        <div>
          <label className="label block mb-1">Status</label>
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="available">Available</option>
            <option value="occupied">Occupied</option>
            <option value="reserved">Reserved</option>
            <option value="dirty">Dirty</option>
            <option value="clean">Clean</option>
            <option value="inspected">Inspected</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </div>
        <div>
          <label className="label block mb-1">Type</label>
          <select className="input w-40" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {roomTypes.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <Loader />
        ) : rooms.length === 0 ? (
          <div className="p-6 text-textSecondary">No rooms match these filters.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>Type</th>
                <th>Rate</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono font-medium">{r.roomNumber}</td>
                  <td>{r.floor}</td>
                  <td className="capitalize">{labelForRoomType(roomTypes, r.roomType)}</td>
                  <td className="font-mono">{inr(r.baseRate)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-right">
                    <button
                      className="text-accentBlue text-xs hover:underline"
                      onClick={() => setEditing(r)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(showAdd || editing) && (
        <RoomModal
          room={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RoomModal({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!room;
  const { data: roomTypes = [] } = useRoomTypes({ includeArchived: isEdit });
  const [form, setForm] = useState({
    roomNumber: room?.roomNumber ?? "",
    floor: room?.floor ?? 1,
    roomType: room?.roomType ?? "",
    baseRate: room ? Number(room.baseRate) : 0,
    maxOccupancy: room?.maxOccupancy ?? 2,
    hasAc: room?.hasAc ?? true,
    hasTv: room?.hasTv ?? true,
    hasWifi: room?.hasWifi ?? true,
    notes: room?.notes ?? "",
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!form.roomType && roomTypes.length && !isEdit) {
      const first = roomTypes[0]!;
      setForm((f) => ({
        ...f,
        roomType: first.slug,
        baseRate: Number(first.defaultRate),
        maxOccupancy: Number(first.maxOccupancy),
      }));
    }
  }, [roomTypes, form.roomType, isEdit]);

  function changeType(slug: string) {
    const t = roomTypes.find((x) => x.slug === slug);
    setForm({
      ...form,
      roomType: slug,
      baseRate: t ? Number(t.defaultRate) : form.baseRate,
      maxOccupancy: t ? Number(t.maxOccupancy) : form.maxOccupancy,
    });
  }

  const save = useMutation({
    mutationFn: () =>
      isEdit ? api.put(`/rooms/${room!.id}`, form) : api.post("/rooms", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-md w-full max-w-lg p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-navy">
          {isEdit ? `Edit Room ${room!.roomNumber}` : "Add Room"}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Room Number">
            <input
              className="input"
              value={form.roomNumber}
              onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
              required
            />
          </Field>
          <Field label="Floor">
            <input
              className="input"
              type="number"
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: Number(e.target.value) })}
            />
          </Field>
          <Field label="Type">
            {roomTypes.length === 0 ? (
              <div className="text-xs text-danger">
                No room types defined. Add some in Settings → Room Types first.
              </div>
            ) : (
              <select
                className="input"
                value={form.roomType}
                onChange={(e) => changeType(e.target.value)}
              >
                {roomTypes.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        {form.roomType && (
          <div className="text-xs text-textSecondary -mt-1">
            Rate ₹{form.baseRate} · Max occupancy {form.maxOccupancy} (from room type)
          </div>
        )}

        <div>
          <div className="label mb-2">Amenities</div>
          <div className="flex flex-wrap gap-2">
            <AmenityToggle
              icon={<Snowflake className="w-4 h-4" />}
              label="AC"
              active={form.hasAc}
              onClick={() => setForm({ ...form, hasAc: !form.hasAc })}
            />
            <AmenityToggle
              icon={<Tv className="w-4 h-4" />}
              label="TV"
              active={form.hasTv}
              onClick={() => setForm({ ...form, hasTv: !form.hasTv })}
            />
            <AmenityToggle
              icon={<Wifi className="w-4 h-4" />}
              label="WiFi"
              active={form.hasWifi}
              onClick={() => setForm({ ...form, hasWifi: !form.hasWifi })}
            />
          </div>
        </div>

        <Field label="Notes">
          <input
            className="input"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>

        {err && <div className="text-danger text-xs">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.roomNumber}
          >
            {save.isPending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label block mb-1">{label}</label>
      {children}
    </div>
  );
}

function AmenityToggle({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-sm border-2 text-sm font-medium transition ${
        active
          ? "bg-accentBlue text-white border-accentBlue shadow-sm"
          : "bg-bg text-textSecondary border-borderc hover:border-accentBlue/60 hover:text-navy"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
