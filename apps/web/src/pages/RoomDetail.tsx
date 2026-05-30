import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Snowflake, Tv, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader } from "@/components/Loader";
import { useRoomTypes } from "@/hooks/useRoomTypes";
import { api } from "@/lib/api";

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

export default function RoomDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: roomTypes = [] } = useRoomTypes({ includeArchived: true });

  const { data, isLoading } = useQuery({
    queryKey: ["room", id],
    queryFn: () => api.get<Room>(`/rooms/${id}`),
    enabled: !!id,
  });

  const [form, setForm] = useState<Partial<Room> | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const update = useMutation({
    mutationFn: () =>
      api.put(`/rooms/${id}`, {
        ...form,
        baseRate: form?.baseRate !== undefined ? Number(form.baseRate) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["room", id] });
      navigate("/rooms");
    },
  });

  if (isLoading || !form) return <Loader size="lg" />;

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-2xl font-bold text-navy">Room {form.roomNumber}</h1>

      <div className="card grid grid-cols-2 gap-3">
        <Field label="Room Number">
          <input
            className="input"
            value={form.roomNumber ?? ""}
            onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
          />
        </Field>
        <Field label="Floor">
          <input
            className="input"
            type="number"
            value={form.floor === undefined || form.floor === 0 ? "" : form.floor}
            onChange={(e) => {
              const v = e.target.value;
              setForm({ ...form, floor: v === "" ? 0 : Number(v) });
            }}
          />
        </Field>
        <Field label="Type">
          <select
            className="input"
            value={form.roomType ?? ""}
            onChange={(e) => setForm({ ...form, roomType: e.target.value })}
          >
            {roomTypes.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.label}
                {!t.isActive ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base Rate (₹)">
          <input
            className="input"
            type="number"
            value={!form.baseRate || form.baseRate === "0" ? "" : form.baseRate}
            onChange={(e) => setForm({ ...form, baseRate: e.target.value })}
          />
        </Field>
        <Field label="Max Occupancy">
          <input
            className="input"
            type="number"
            value={
              form.maxOccupancy === undefined || form.maxOccupancy === 0
                ? ""
                : form.maxOccupancy
            }
            onChange={(e) => {
              const v = e.target.value;
              setForm({ ...form, maxOccupancy: v === "" ? 0 : Number(v) });
            }}
            onBlur={() => {
              if (!form.maxOccupancy) setForm({ ...form, maxOccupancy: 1 });
            }}
          />
        </Field>
      </div>

      <div className="card">
        <div className="label mb-2">Amenities</div>
        <div className="flex flex-wrap gap-2">
          <AmenityToggle
            icon={<Snowflake className="w-4 h-4" />}
            label="AC"
            active={!!form.hasAc}
            onClick={() => setForm({ ...form, hasAc: !form.hasAc })}
          />
          <AmenityToggle
            icon={<Tv className="w-4 h-4" />}
            label="TV"
            active={!!form.hasTv}
            onClick={() => setForm({ ...form, hasTv: !form.hasTv })}
          />
          <AmenityToggle
            icon={<Wifi className="w-4 h-4" />}
            label="Wi-Fi"
            active={!!form.hasWifi}
            onClick={() => setForm({ ...form, hasWifi: !form.hasWifi })}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={() => navigate("/rooms")}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => update.mutate()} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </button>
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
