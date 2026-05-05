import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
            value={form.floor ?? 0}
            onChange={(e) => setForm({ ...form, floor: Number(e.target.value) })}
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
            value={form.baseRate ?? 0}
            onChange={(e) => setForm({ ...form, baseRate: e.target.value })}
          />
        </Field>
        <Field label="Max Occupancy">
          <input
            className="input"
            type="number"
            value={form.maxOccupancy ?? 1}
            onChange={(e) => setForm({ ...form, maxOccupancy: Number(e.target.value) })}
          />
        </Field>
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
