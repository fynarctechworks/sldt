import { cn } from "@/lib/utils";
import type { RoomStatus } from "@hoteldesk/shared";

const STYLES: Record<RoomStatus, string> = {
  available: "bg-success/15 text-success",
  occupied: "bg-accentBlue/15 text-accentBlue",
  reserved: "bg-warning/15 text-warning",
  dirty: "bg-warning/20 text-[#B45309]",
  maintenance: "bg-danger/15 text-danger",
  clean: "bg-yellow-100 text-yellow-800",
  inspected: "bg-success/15 text-success",
};

export function StatusBadge({ status }: { status: RoomStatus | string }) {
  const cls = STYLES[status as RoomStatus] ?? "bg-gray-200 text-gray-700";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-xs font-medium uppercase tracking-wide rounded-sm",
        cls,
      )}
    >
      {String(status).replace("_", " ")}
    </span>
  );
}
