import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";

interface Staff {
  id: string;
  fullName: string;
  role: string;
  email: string;
}
interface Thread {
  other_id: string;
  full_name: string;
  role: string;
  last_body: string;
  last_at: string;
  unread: number;
}
interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function Messages() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("with");

  const staffQ = useQuery({
    queryKey: ["staff-list"],
    queryFn: () => api.get<{ items: Staff[] }>("/messages/staff"),
  });
  const threadsQ = useQuery({
    queryKey: ["msg-threads"],
    queryFn: () => api.get<{ items: Thread[] }>("/messages/threads"),
    refetchInterval: 15000,
  });
  const msgsQ = useQuery({
    queryKey: ["msg-thread", activeId],
    queryFn: () =>
      activeId ? api.get<{ items: Message[] }>("/messages", { with: activeId }) : Promise.resolve({ items: [] }),
    enabled: !!activeId,
    refetchInterval: activeId ? 8000 : false,
  });

  const qc = useQueryClient();
  const sendM = useMutation({
    mutationFn: (body: string) => api.post<Message>("/messages", { recipientId: activeId, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msg-thread", activeId] });
      qc.invalidateQueries({ queryKey: ["msg-threads"] });
    },
  });

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hoist the message count so the dep array stays statically
  // analysable. ESLint can't follow the `?? []` inside the array,
  // and the extracted local lets the rule see exactly what changes.
  const messageCount = msgsQ.data?.items?.length ?? 0;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messageCount, activeId]);

  const activeStaff = (staffQ.data?.items ?? []).find((s) => s.id === activeId);

  return (
    <div className="grid grid-cols-[18rem_1fr] gap-4 h-[calc(100vh-6.5rem)]">
      <aside className="card p-0 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-borderc font-semibold">Conversations</div>
        <div className="overflow-y-auto flex-1">
          {(threadsQ.data?.items ?? []).map((t) => (
            <button
              key={t.other_id}
              onClick={() => setParams({ with: t.other_id })}
              className={`w-full text-left px-4 py-3 border-b border-borderc/50 hover:bg-bg ${
                activeId === t.other_id ? "bg-brand-soft" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm truncate">{t.full_name}</div>
                {t.unread > 0 && (
                  <span className="ml-2 grid place-items-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-brand text-cream text-[10px]">
                    {t.unread}
                  </span>
                )}
              </div>
              <div className="text-xs text-textSecondary truncate mt-0.5">{t.last_body}</div>
            </button>
          ))}
          {(threadsQ.data?.items ?? []).length === 0 && (
            <div className="p-4 text-xs text-textSecondary">No conversations yet. Start one below.</div>
          )}
        </div>
        <div className="border-t border-borderc">
          <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-textSecondary">Staff</div>
          <div className="max-h-48 overflow-y-auto pb-2">
            {(staffQ.data?.items ?? []).map((s) => (
              <button
                key={s.id}
                onClick={() => setParams({ with: s.id })}
                className={`w-full text-left px-4 py-2 hover:bg-bg text-sm ${
                  activeId === s.id ? "bg-brand-soft" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.fullName}</span>
                  <span className="text-[10px] text-textSecondary capitalize">{s.role}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="card p-0 flex flex-col overflow-hidden">
        {!activeId && (
          <div className="flex-1 grid place-items-center text-textSecondary text-sm">
            Select a conversation
          </div>
        )}
        {activeId && (
          <>
            <div className="px-4 py-3 border-b border-borderc">
              <div className="font-semibold">{activeStaff?.fullName ?? "Conversation"}</div>
              <div className="text-xs text-textSecondary capitalize">{activeStaff?.role}</div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
              {msgsQ.isLoading && (
                <div className="text-center text-textSecondary text-sm py-6">
                  <Loader2 className="inline w-4 h-4 animate-spin" />
                </div>
              )}
              {(msgsQ.data?.items ?? []).map((m) => {
                const mine = m.senderId === profile?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] px-3 py-2 rounded-md text-sm ${
                        mine
                          ? "bg-brand text-cream rounded-br-sm"
                          : "bg-bg text-textPrimary rounded-bl-sm border border-borderc"
                      }`}
                    >
                      <div>{m.body}</div>
                      <div className={`text-[10px] mt-0.5 ${mine ? "text-cream/70" : "text-textSecondary"}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                );
              })}
              {(msgsQ.data?.items ?? []).length === 0 && (
                <div className="text-center text-textSecondary text-sm py-6">No messages yet. Say hello.</div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim() || sendM.isPending) return;
                sendM.mutate(draft.trim(), {
                  onSuccess: () => setDraft(""),
                });
              }}
              className="border-t border-borderc p-3 flex items-center gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="input flex-1"
                placeholder="Type a message"
              />
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={!draft.trim() || sendM.isPending}
              >
                {sendM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
