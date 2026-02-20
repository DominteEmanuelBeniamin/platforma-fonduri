"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Send,
  X,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/app/providers/AuthProvider";
import { useProjectChat } from "@/hooks/useProjectChat";
import { getAvatarColor, getInitials } from "@/lib/avatar";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  projectId: string;
};

export default function ProjectChatDrawer({
  open,
  onClose,
  title = "Chat proiect",
  projectId,
}: Props) {
  const { loading: authLoading, userId, profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const {
    messages,
    loading,
    sending,
    error,
    hasMore,
    loadMore,
    sendMessage,
    editMessage,
    deleteMessage,
  } = useProjectChat(projectId, { initialLimit: 50 });

  const [text, setText] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const prevScrollHeightRef = useRef<number | null>(null);
  const userPinnedToBottomRef = useRef(true);

  const canSend = !authLoading && !sending && text.trim().length > 0;

  const startEdit = (id: string, currentBody?: string | null) => {
    if (!currentBody) return
    setEditingId(id)
    setEditText(currentBody)
  }
  

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (id: string) => {
    await editMessage(id, editText);
    cancelEdit();
  };

  const scrollToBottom = (smooth = false) => {
    bottomRef.current?.scrollIntoView({
      block: "end",
      behavior: smooth ? "smooth" : "auto",
    });
  };

  const isNearBottom = () => {
    const el = listRef.current;
    if (!el) return true;
    const threshold = 80;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // lock background scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // autosize textarea
  useEffect(() => {
    if (!open) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text, open]);

  // track scroll position (to decide auto-scroll on new messages)
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      userPinnedToBottomRef.current = isNearBottom();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  // when drawer opens: scroll bottom after initial render
  useEffect(() => {
    if (!open) return;
    // mic delay ca să existe layout
    const t = setTimeout(() => scrollToBottom(false), 0);
    return () => clearTimeout(t);
  }, [open]);

  // when messages change:
  // - if user is at bottom -> auto scroll (realtime + send)
  // - if we did loadMore -> preserve scroll position (handled below)
  useEffect(() => {
    if (!open) return;

    // dacă tocmai am făcut loadMore, păstrăm poziția
    const prevH = prevScrollHeightRef.current;
    if (prevH != null) {
      const el = listRef.current;
      if (el) {
        const newH = el.scrollHeight;
        const delta = newH - prevH;
        el.scrollTop += delta;
      }
      prevScrollHeightRef.current = null;
      return;
    }

    // altfel, scroll doar dacă user e la bottom
    if (userPinnedToBottomRef.current) {
      scrollToBottom(false);
    }
  }, [messages.length, open]);

  const handleSend = async () => {
    if (!canSend) return;
    const body = text.trim();
    setText("");
    await sendMessage(body);
    // pentru “da la toate”: după send, scroll bottom
    setTimeout(() => scrollToBottom(false), 0);
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLoadMore = async () => {
    const el = listRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;
    await loadMore();
  };

  if (!open) return null;

  const GROUP_GAP_MS = 2 * 60 * 1000; // 2 minute

  const toMs = (iso: string) => new Date(iso).getTime();

  const isSameDay = (aIso: string, bIso: string) => {
    const a = new Date(aIso);
    const b = new Date(bIso);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  };

  const formatDayLabel = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();

    // today
    if (isSameDay(iso, now.toISOString())) return "Today";

    // yesterday
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (
      d.getFullYear() === y.getFullYear() &&
      d.getMonth() === y.getMonth() &&
      d.getDate() === y.getDate()
    ) {
      return "Yesterday";
    }

    // fallback: 20 Feb 2026
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Overlay (click closes) */}
      <button
        aria-label="Close chat"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />

      {/* Panel */}
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[min(520px,90vw)] bg-white border-l border-slate-200 shadow-2xl flex flex-col rounded-none sm:rounded-l-2xl">
        {/* Header */}
        <div className="border-b border-slate-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 rounded-none sm:rounded-tl-2xl pt-[env(safe-area-inset-top)]">
          <div className="h-14 px-3 flex items-center justify-between">
            <button
              onClick={onClose}
              className="sm:hidden inline-flex items-center gap-2 px-2 py-2 rounded-md hover:bg-slate-100 text-slate-700"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm font-medium">Back</span>
            </button>

            <div className="hidden sm:flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            </div>

            <button
              onClick={onClose}
              className="hidden sm:inline-flex p-2 rounded-md hover:bg-slate-100 text-slate-500"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="sm:hidden px-4 pb-3 -mt-1">
            <div className="text-sm font-semibold text-slate-900">{title}</div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          onClick={() => setOpenMenuId(null)}
          className="flex-1 overflow-y-auto p-4"
        >
          {hasMore && (
            <div className="flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className={[
                  "px-3 py-1.5 rounded-xl text-sm border shadow-sm",
                  loading
                    ? "bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                {loading ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!error && loading && messages.length === 0 ? (
            <div className="text-sm text-slate-500">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No messages yet. Say hi 👋
            </div>
          ) : (
            messages.map((m, idx) => {
              const prev = idx > 0 ? messages[idx - 1] : null;
              const isMe = userId && m.created_by === userId;
              const canManage =
                !m.deleted_at &&
                (isAdmin || (userId && m.created_by === userId));
              const isEditing = editingId === m.id;

              const prevSameAuthor = !!prev && prev.created_by === m.created_by;
              const gapMs = prev
                ? toMs(m.created_at) - toMs(prev.created_at)
                : 0;
              const brokeByTime = prev ? gapMs > GROUP_GAP_MS : true;
              const showDaySeparator =
                !prev || !isSameDay(prev.created_at, m.created_at);

              const shouldShowHeader =
                !isMe && (!prevSameAuthor || brokeByTime);
              const profile = m.profiles;
              const displayName =
                profile?.full_name || profile?.email || "Unknown";
              const initials = getInitials(profile?.full_name, profile?.email);
              const color = getAvatarColor(
                profile?.full_name || profile?.email || m.created_by
              );

              return (
                <div key={m.id}>
                  {showDaySeparator && (
                    <div className="flex justify-center my-4">
                      <div className="px-3 py-1 rounded-full text-[12px] font-medium text-slate-500 bg-white/80 backdrop-blur border border-slate-200 shadow-sm">
                        {formatDayLabel(m.created_at)}
                      </div>
                    </div>
                  )}

                  <div
                    className={[
                      `flex ${isMe ? "justify-end" : "justify-start"}`,
                      shouldShowHeader ? "mt-3" : "mt-1",
                    ].join(" ")}
                  >
                    {/* Others: avatar column */}
                    {!isMe && (
                      <div className="mr-2 w-8 flex justify-center">
                        {shouldShowHeader ? (
                          <div
                            className="w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-bold shadow-sm"
                            style={{
                              background: `linear-gradient(to bottom right, ${color.from}, ${color.to})`,
                            }}
                            title={displayName}
                          >
                            {initials}
                          </div>
                        ) : (
                          <div className="w-8 h-8" />
                        )}
                      </div>
                    )}

                    {/* Message content */}
                    <div className="max-w-[85%] group">
                      {!isMe && shouldShowHeader && (
                        <div className="mb-1 text-[12px] text-slate-500">
                          {displayName}
                        </div>
                      )}

                      {(() => {
                        const canManage =
                          !m.deleted_at &&
                          (isAdmin || (userId && m.created_by === userId));
                        const isEditing = editingId === m.id;

                        if (isEditing) {
                          return (
                            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                                rows={3}
                              />
                              <div className="mt-2 flex justify-end gap-2">
                                <button
                                  onClick={cancelEdit}
                                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => saveEdit(m.id)}
                                  className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            className={[
                              "rounded-2xl px-3 py-2 text-sm border shadow-sm relative",
                              isMe
                                ? "bg-slate-900 text-white border-slate-900"
                                : "bg-white text-slate-900 border-slate-200",
                            ].join(" ")}
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {m.deleted_at ? (
                                <span className="text-slate-400 italic">
                                  Message deleted
                                </span>
                              ) : (
                                m.body
                              )}
                            </div>

                            {/* Kebab trigger (hover) */}
                            {canManage && (
                              <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId((prev) =>
                                      prev === m.id ? null : m.id
                                    );
                                  }}
                                  className="p-1.5 rounded-xl border border-slate-200 bg-white shadow-sm hover:bg-slate-50 text-slate-700"
                                  aria-label="Message options"
                                  title="Options"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                              </div>
                            )}

                            {/* Menu */}
                            {canManage && openMenuId === m.id && (
                              <div
                                className="absolute top-7 right-2 z-10"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="min-w-[160px] rounded-xl border border-slate-200 bg-white shadow-lg p-1">
                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-slate-50 text-slate-700"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      if (m.deleted_at || !m.body) return;
                                      startEdit(m.id, m.body);
                                    }}
                                  >
                                    <Pencil className="w-4 h-4" />
                                    Edit
                                  </button>

                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-rose-50 text-rose-700"
                                    onClick={async () => {
                                      setOpenMenuId(null);
                                      if (!confirm("Delete this message?"))
                                        return;
                                      await deleteMessage(m.id);
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div
                        className={`h-4 mt-1 text-[11px] text-slate-400 ${
                          isMe ? "text-right" : "text-left"
                        } opacity-0 group-hover:opacity-100 transition-opacity`}
                      >
                        {formatTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 p-3 bg-white rounded-none sm:rounded-bl-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onTextareaKeyDown}
                placeholder="Scrie un mesaj… (Enter = trimite, Shift+Enter = rând nou)"
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 min-h-[40px]"
                rows={1}
              />
            </div>

            <button
              onClick={handleSend}
              disabled={!canSend}
              className={[
                "h-[40px] px-3 rounded-xl inline-flex items-center gap-2 text-sm font-medium",
                canSend
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed",
              ].join(" ")}
            >
              <Send className="w-4 h-4" />
              {sending ? "Sending…" : "Trimite"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
