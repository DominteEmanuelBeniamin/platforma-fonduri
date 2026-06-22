/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  onUnreadCountChange?: (count: number) => void;
};

export default function ProjectChatDrawer({
  open,
  onClose,
  title = "Chat proiect",
  projectId,
  onUnreadCountChange,
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
    unreadCount,
    markAsRead,
    lastReadAt,
    readStates,
  } = useProjectChat(projectId, { initialLimit: 50 });

  const [text, setText] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    setIsMounted(true);
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [initialReadBoundary, setInitialReadBoundary] = useState<string | null>(null);

  const prevScrollHeightRef = useRef<number | null>(null);
  const openBoundaryCapturedRef = useRef(false);
  const userPinnedToBottomRef = useRef(true);

  const canSend = !authLoading && !sending && text.trim().length > 0;

  const latestUnreadIncomingCreatedAt = useMemo(() => {
    if (!userId) return null;

    const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : null;
    let latestCreatedAt: string | null = null;

    for (const m of messages) {
      if (m.deleted_at) continue;
      if (m.created_by === userId) continue;

      const createdTime = new Date(m.created_at).getTime();
      if (lastReadTime !== null && createdTime <= lastReadTime) continue;

      if (!latestCreatedAt || createdTime > new Date(latestCreatedAt).getTime()) {
        latestCreatedAt = m.created_at;
      }
    }

    return latestCreatedAt;
  }, [lastReadAt, messages, userId]);

  const firstUnreadMessageId = useMemo(() => {
    if (!userId) return null;

    const boundaryTime = initialReadBoundary ? new Date(initialReadBoundary).getTime() : null;

    return (
      messages.find((m) => {
        if (m.deleted_at) return false;
        if (m.created_by === userId) return false;
        if (boundaryTime === null) return true;
        return new Date(m.created_at).getTime() > boundaryTime;
      })?.id ?? null
    );
  }, [initialReadBoundary, messages, userId]);

  const projectReadReceipt = useMemo(() => {
    if (!userId) return null;

    const otherParticipantCount = Math.max(readStates.length - 1, 0);
    if (otherParticipantCount === 0) return null;

    let receipt: { messageId: string; label: string } | null = null;

    for (const m of messages) {
      if (m.deleted_at) continue;
      if (m.created_by !== userId) continue;

      const messageTime = new Date(m.created_at).getTime();
      const readByCount = readStates.filter((row) => {
        if (row.user_id === userId) return false;
        if (!row.last_read_at) return false;
        return new Date(row.last_read_at).getTime() >= messageTime;
      }).length;

      if (readByCount > 0) {
        receipt = {
          messageId: m.id,
          label:
            readByCount >= otherParticipantCount
              ? "Citit de toți"
              : `Citit de ${readByCount}`,
        };
      }
    }

    return receipt;
  }, [messages, readStates, userId]);

  const startEdit = (id: string, currentBody?: string | null) => {
    if (!currentBody) return;
    setEditingId(id);
    setEditText(currentBody);
  };

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
      if (e.key === "Escape") {
        setOpenMenuId(null);
        if (editingId) cancelEdit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingId) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, editingId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text, open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      userPinnedToBottomRef.current = isNearBottom();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  useEffect(() => {
    if (!open) {
      openBoundaryCapturedRef.current = false;
      setInitialReadBoundary(null);
      return;
    }

    if (openBoundaryCapturedRef.current) return;
    openBoundaryCapturedRef.current = true;

    const t = setTimeout(() => scrollToBottom(false), 50);
    setInitialReadBoundary(lastReadAt);
    return () => clearTimeout(t);
  }, [lastReadAt, open]);

  useEffect(() => {
    if (!open) return;
    const prevH = prevScrollHeightRef.current;
    if (prevH != null) {
      const el = listRef.current;
      if (el) {
        const newH = el.scrollHeight;
        el.scrollTop += newH - prevH;
      }
      prevScrollHeightRef.current = null;
      return;
    }
    if (userPinnedToBottomRef.current) {
      scrollToBottom(false);
    }
    if (latestUnreadIncomingCreatedAt) {
      void markAsRead(latestUnreadIncomingCreatedAt);
    }
  }, [latestUnreadIncomingCreatedAt, markAsRead, messages.length, open]);

  const handleSend = async () => {
    if (!canSend) return;
    const body = text.trim();
    setText("");
    await sendMessage(body);
    setTimeout(() => scrollToBottom(false), 0);
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open || !isMounted) return null;

  const GROUP_GAP_MS = 2 * 60 * 1000;
  const toMs = (iso: string) => new Date(iso).getTime();
  const isSameDay = (aIso: string, bIso: string) => {
    const a = new Date(aIso);
    const b = new Date(bIso);
    return a.toDateString() === b.toDateString();
  };

  const formatDayLabel = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (isSameDay(iso, now.toISOString())) return "Astăzi";
    now.setDate(now.getDate() - 1);
    if (isSameDay(iso, now.toISOString())) return "Ieri";
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

  const drawerContent = (
    <div className="fixed inset-0 z-[999999]">
      <button
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm cursor-default"
      />

      <aside className="absolute right-0 top-0 h-full w-full sm:w-[min(520px,90vw)] bg-white shadow-2xl flex flex-col sm:rounded-l-2xl overflow-hidden animate-in slide-in-from-right duration-300">
        <div className="z-10 bg-white/80 backdrop-blur-md border-b border-slate-100 pt-[env(safe-area-inset-top)]">
          <div className="h-16 px-4 flex items-center justify-between">
            <button
              onClick={onClose}
              className="sm:hidden p-2 -ml-2 rounded-xl hover:bg-slate-100 text-slate-600"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                {title}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="hidden sm:inline-flex p-2 -mr-2 rounded-xl hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div
          ref={listRef}
          onClick={() => setOpenMenuId(null)}
          className="flex-1 overflow-y-auto p-4 bg-slate-50/50"
        >
          {hasMore && (
            <div className="flex justify-center pb-4 pt-2">
              <button
                onClick={() => {
                  prevScrollHeightRef.current =
                    listRef.current?.scrollHeight || null;
                  loadMore();
                }}
                disabled={loading}
                className="px-4 py-2 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200 shadow-sm hover:bg-slate-50"
              >
                {loading ? "Se încarcă..." : "Afișează mesaje mai vechi"}
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {messages.map((m, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null;
            const next = idx < messages.length - 1 ? messages[idx + 1] : null;
            const isMe = userId && m.created_by === userId;
            const isEditing = editingId === m.id;
            const showNewMessagesSeparator = firstUnreadMessageId === m.id;
            const showReadReceipt = projectReadReceipt?.messageId === m.id;
            const readReceiptLabel = showReadReceipt ? projectReadReceipt?.label : null;

            const prevSameDay = prev
              ? isSameDay(prev.created_at, m.created_at)
              : false;
            const nextSameDay = next
              ? isSameDay(m.created_at, next.created_at)
              : false;
            const isSameGroupAsPrev =
              prev &&
              prev.created_by === m.created_by &&
              toMs(m.created_at) - toMs(prev.created_at) <= GROUP_GAP_MS &&
              prevSameDay;
            const isSameGroupAsNext =
              next &&
              next.created_by === m.created_by &&
              toMs(next.created_at) - toMs(m.created_at) <= GROUP_GAP_MS &&
              nextSameDay;

            const showDaySeparator = !prev || !prevSameDay;
            const shouldShowHeader = !isMe && !isSameGroupAsPrev;
            const isEdited = !!m.edited_at && m.edited_at !== m.created_at && !m.deleted_at;
            const shouldShowMeta = !isSameGroupAsNext || isEdited || showReadReceipt;

            // Reducem spațiul dintre mesajele din același grup
            const marginTopClass = showDaySeparator
              ? "mt-6"
              : isSameGroupAsPrev
              ? "mt-1"
              : "mt-4";

            const color = getAvatarColor(
              m.profiles?.full_name || m.profiles?.email || m.created_by
            );
            const initials = getInitials(
              m.profiles?.full_name,
              m.profiles?.email
            );

            let bubbleRadius = "rounded-2xl";
            if (isMe) {
              if (!isSameGroupAsPrev && isSameGroupAsNext)
                bubbleRadius = "rounded-2xl rounded-br-sm";
              else if (isSameGroupAsPrev && isSameGroupAsNext)
                bubbleRadius = "rounded-l-2xl rounded-r-sm";
              else if (isSameGroupAsPrev && !isSameGroupAsNext)
                bubbleRadius = "rounded-2xl rounded-tr-sm";
            } else {
              if (!isSameGroupAsPrev && isSameGroupAsNext)
                bubbleRadius = "rounded-2xl rounded-bl-sm";
              else if (isSameGroupAsPrev && isSameGroupAsNext)
                bubbleRadius = "rounded-r-2xl rounded-l-sm";
              else if (isSameGroupAsPrev && !isSameGroupAsNext)
                bubbleRadius = "rounded-2xl rounded-tl-sm";
            }

            return (
              <div key={m.id} className="group/row">
                {showDaySeparator && (
                  <div className="flex justify-center my-6">
                    <span className="px-3 py-1 rounded-full text-[11px] font-semibold uppercase text-slate-400 bg-slate-100/80">
                      {formatDayLabel(m.created_at)}
                    </span>
                  </div>
                )}

                {showNewMessagesSeparator && (
                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-emerald-200" />
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase text-emerald-700 ring-1 ring-emerald-100">
                      Mesaje noi
                    </span>
                    <div className="h-px flex-1 bg-emerald-200" />
                  </div>
                )}

                <div
                  className={`flex flex-col w-full ${
                    isMe ? "items-end" : "items-start"
                  } ${marginTopClass}`}
                >
                  {/* 1. Numele (apare doar la primul mesaj din grup) */}
                  {!isMe && shouldShowHeader && (
                    <span className="text-[11px] font-medium text-slate-500 mb-1 ml-10">
                      {m.profiles?.full_name ||
                        m.profiles?.email ||
                        "Necunoscut"}
                    </span>
                  )}

                  {/* 2. Rândul orizontal: conține DOAR avatarul și bula (aliniate la bază) */}
                  <div
                    className={`flex items-end max-w-[85%] sm:max-w-[75%] ${
                      isMe ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {/* Secțiune avatar */}
                    {!isMe && (
                      <div className="mr-2 w-8 flex-shrink-0 flex justify-center">
                        {!isSameGroupAsNext ? (
                          <div
                            className="w-8 h-8 rounded-full text-white flex items-center justify-center text-[11px] font-bold shadow-sm mb-[2px] animate-in fade-in zoom-in-50 duration-200"
                            style={{
                              background: `linear-gradient(135deg, ${color.from}, ${color.to})`,
                            }}
                          >
                            {initials}
                          </div>
                        ) : (
                          <div className="w-8" />
                        )}
                      </div>
                    )}

                    {/* Conținut mesaj (bula sau editorul) */}
                    <div
                      className={`relative group/bubble flex items-center gap-2 ${
                        isMe ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {isEditing ? (
                        <div className="w-full min-w-[280px] bg-white rounded-2xl border-2 border-slate-900 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-slate-800 focus:outline-none min-h-[100px]"
                          />
                          <div className="flex justify-end gap-2 p-2 bg-slate-50 border-t border-slate-100">
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded-lg"
                            >
                              Anulează
                            </button>
                            <button
                              onClick={() => saveEdit(m.id)}
                              className="px-3 py-1.5 text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 rounded-lg shadow-md"
                            >
                              Salvează
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Bula de mesaj */}
                          <div
                            onContextMenu={(e) => {
                              if (window.innerWidth < 640) {
                                e.preventDefault();
                                setOpenMenuId(m.id);
                              }
                            }}
                            className={`relative px-4 py-2.5 text-[14px] leading-relaxed shadow-sm transition-all active:scale-[0.98] sm:active:scale-100 ${
                              isMe
                                ? "bg-slate-900 text-white"
                                : "bg-white text-slate-800 border border-slate-100"
                            } ${bubbleRadius}`}
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {m.deleted_at ? (
                                <span className="italic text-slate-400/80 text-sm">
                                  Acest mesaj a fost șters.
                                </span>
                              ) : (
                                m.body
                              )}
                            </div>
                          </div>

                          {/* Butonul de meniu (MoreHorizontal) - poziționat dinamic */}
                          {!m.deleted_at && (isAdmin || isMe) && (
                            <div
                              className={`relative flex-shrink-0 transition-opacity ${
                                openMenuId === m.id
                                  ? "opacity-100"
                                  : "opacity-0 group-hover/bubble:opacity-100"
                              }`}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(
                                    openMenuId === m.id ? null : m.id
                                  );
                                }}
                                className={`p-1.5 rounded-full transition-colors ${
                                  openMenuId === m.id
                                    ? "bg-slate-200 text-slate-800"
                                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/50"
                                }`}
                              >
                                <MoreHorizontal className="w-[18px] h-[18px]" />
                              </button>

                              {/* Meniul Dropdown - se deschide spre interiorul chat-ului */}
                              {openMenuId === m.id && (
                                <div
                                  className={`absolute bottom-full mb-2 z-50 min-w-[140px] bg-white rounded-xl shadow-xl border border-slate-100 p-1.5 ${
                                    isMe ? "right-0" : "left-0"
                                  }`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg hover:bg-slate-50 text-slate-700"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      startEdit(m.id, m.body);
                                    }}
                                  >
                                    <Pencil className="w-4 h-4 text-slate-400" />{" "}
                                    Editează
                                  </button>
                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg hover:bg-rose-50 text-rose-600"
                                    onClick={async () => {
                                      setOpenMenuId(null);
                                      if (
                                        confirm(
                                          "Ești sigur că vrei să ștergi acest mesaj?"
                                        )
                                      )
                                        await deleteMessage(m.id);
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 text-rose-500" />{" "}
                                    Șterge
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 3. Ora (apare sub rândul cu avatar și bulă) */}
                  {shouldShowMeta && (
                    <div
                      className={`mt-1 text-[10px] font-medium text-slate-400 flex items-center gap-1.5 ${
                        isMe ? "justify-end mr-1" : "justify-start ml-10"
                      }`}
                    >
                      <span>{formatTime(m.created_at)}</span>

                      {isEdited && (
                          <span className="flex items-center gap-0.5 opacity-70">
                            <span className="w-0.5 h-0.5 rounded-full bg-slate-400" />{" "}
                            Editat
                          </span>
                        )}

                      {readReceiptLabel && (
                        <span className="flex items-center gap-0.5 opacity-70">
                          <span className="w-0.5 h-0.5 rounded-full bg-slate-400" />{" "}
                          {readReceiptLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} className="h-2" />
        </div>

        <div className="z-10 bg-white p-3 sm:p-4 border-t border-slate-100 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-[20px] p-1.5 focus-within:ring-2 focus-within:ring-slate-900/10 focus-within:bg-white focus-within:border-slate-300 transition-all shadow-sm">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onTextareaKeyDown}
              placeholder="Scrie un mesaj..."
              className="flex-1 bg-transparent resize-none px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none max-h-[120px]"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`h-[38px] px-4 rounded-2xl flex-shrink-0 flex items-center gap-2 text-sm font-semibold transition-all mb-0.5 mr-0.5 ${
                canSend
                  ? "bg-slate-900 text-white shadow-md hover:bg-slate-800 hover:scale-[1.02] active:scale-95"
                  : "bg-transparent text-slate-300 cursor-not-allowed"
              }`}
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-[18px] h-[18px]" />
              )}
              <span className="hidden sm:inline-block">Trimite</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );

  return createPortal(drawerContent, document.body);
}
