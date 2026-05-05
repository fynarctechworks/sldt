import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity as ActivityIcon } from "lucide-react";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";

interface DashboardData {
  recent_activity: { action: string; description: string; performedBy: string; createdAt: string }[];
}

export default function Activity() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <Loader label="Loading activity…" size="lg" />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
        <ActivityIcon className="w-5 h-5" /> Recent Activity
      </h1>

      <div className="card">
        {data.recent_activity.length === 0 ? (
          <div className="text-textSecondary text-sm">No recent activity.</div>
        ) : (
          <ul className="space-y-3 text-sm">
            {data.recent_activity.map((a, i) => (
              <li key={i} className="border-b border-borderc last:border-b-0 pb-3 last:pb-0">
                <div className="text-xs text-textSecondary">
                  {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })} · {a.performedBy}
                </div>
                <div className="mt-0.5">{a.description}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
