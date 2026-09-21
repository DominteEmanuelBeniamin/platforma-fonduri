'use client'

import { Pencil, Trash2, MoreHorizontal } from 'lucide-react'
import type { ChatImage } from '@/lib/project-chat-contracts'
import { getAvatarColor, getInitials } from '@/lib/avatar'
import { toMs, isSameDay, formatDayLabel, formatTime } from './date-helpers'

/**
 * Firul de mesaje al chatului de proiect: separatoare de zi, bule grupate pe
 * autor, imagini, editare pe loc și confirmarea de citire.
 *
 * A stat 329 de linii în burta lui `ProjectChatDrawer`, care ajunsese la 1.496.
 * Tot ce-i trebuie primește prin proprietăți, deci se poate citi fără să ții
 * minte restul componentei.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export default function ChatMessageList({
  messages,
  userId,
  isAdmin,
  firstUnreadMessageId,
  projectReadReceipt,
  renderBody,
  editingId,
  editText,
  setEditText,
  startEdit,
  cancelEdit,
  saveEdit,
  openMenuId,
  setOpenMenuId,
  preview,
  setPreview,
  unavailableImages,
  imageRetryKey,
  requestImageRefresh,
  deleteImage,
  deleteMessage,
  confirm,
}: {
  messages: any[]
  userId: string | null | undefined
  isAdmin: boolean
  firstUnreadMessageId: string | null
  projectReadReceipt: { messageId: string; label: string } | null
  renderBody: (body: string | null, masked?: boolean, isOwn?: boolean) => React.ReactNode
  editingId: string | null
  editText: string
  setEditText: (v: string) => void
  startEdit: (id: string, body: string) => void
  cancelEdit: () => void
  saveEdit: (id: string) => void | Promise<void>
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  preview: { messageId: string; image: ChatImage } | null
  setPreview: (p: { messageId: string; image: ChatImage } | null) => void
  unavailableImages: Set<string>
  imageRetryKey: (messageId: string, image: ChatImage) => string
  requestImageRefresh: (messageId: string, image: ChatImage) => Promise<unknown>
  deleteImage: (messageId: string, path: string) => Promise<any>
  deleteMessage: (id: string) => void | Promise<void>
  confirm: (opts: any) => Promise<boolean>
}) {
  /** Două mesaje ale aceluiași autor, la mai puțin de două minute, se lipesc. */
  const GROUP_GAP_MS = 2 * 60 * 1000;

  return (
    <>
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
            <span className="px-3 py-1 rounded-full text-[11px] font-semibold uppercase text-ink-faint bg-paper-sunk">
              {formatDayLabel(m.created_at)}
            </span>
          </div>
        )}

        {showNewMessagesSeparator && (
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--sg-ok)]" />
            <span className="rounded-full bg-[var(--sg-ok-soft)] px-3 py-1 text-[11px] font-semibold uppercase text-[var(--sg-ok)] ring-1 ring-[var(--sg-ok)]">
              Mesaje noi
            </span>
            <div className="h-px flex-1 bg-[var(--sg-ok)]" />
          </div>
        )}

        <div
          className={`flex flex-col w-full ${
            isMe ? "items-end" : "items-start"
          } ${marginTopClass}`}
        >
          {/* 1. Numele (apare doar la primul mesaj din grup) */}
          {!isMe && shouldShowHeader && (
            <span className="text-[11px] font-medium text-ink-soft mb-1 ml-10">
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
                {/* Textul și pozele au controale independente. */}
                <div
                  onContextMenu={(e) => {
                    if (window.innerWidth < 640) {
                      e.preventDefault();
                      setOpenMenuId(`message:${m.id}`);
                    }
                  }}
                  className={`flex flex-col gap-1.5 ${isMe ? "items-end" : "items-start"}`}
                >
                  {m.deleted_at ? (
                    <div
                      className={`px-4 py-2.5 text-[14px] leading-relaxed ${
                        isMe ? "bg-ink" : "border border-rule bg-white shadow-sm"
                      } ${bubbleRadius}`}
                    >
                      <span className="italic text-ink-faint text-sm">
                        Acest mesaj a fost șters.
                      </span>
                    </div>
                  ) : (
                    <>
                      {isEditing ? (
                        // Doar bula de text e înlocuită: editai un mesaj
                        // cu poze fără să mai vezi la ce se referă.
                        <div className="w-full min-w-[280px] overflow-hidden rounded-2xl border-2 border-rule-strong bg-white shadow-xl animate-in fade-in zoom-in-95 duration-200">
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-ink focus:outline-none min-h-[100px]"
                          />
                          <div className="flex justify-end gap-2 border-t border-rule bg-paper-sunk p-2">
                            <button
                              onClick={cancelEdit}
                              className="rounded-lg px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-paper"
                            >
                              Anulează
                            </button>
                            <button
                              onClick={() => saveEdit(m.id)}
                              disabled={!editText.trim() && !m.images?.length}
                              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white shadow-md hover:brightness-90 disabled:opacity-40 disabled:hover:brightness-100"
                            >
                              Salvează
                            </button>
                          </div>
                        </div>
                      ) : (m.body || m.body_masked) && (
                        <div className="group/message relative">
                          <div
                            className={`px-4 py-2.5 text-[14px] leading-relaxed transition-colors ${
                              m.body_masked
                                ? "border border-[var(--sg-warn)] bg-[var(--sg-warn-soft)] text-ink"
                                : isMe
                                ? "bg-ink text-white"
                                : "border border-rule bg-white text-ink shadow-sm"
                            } ${bubbleRadius}`}
                          >
                            {m.body && (
                              <div className="whitespace-pre-wrap break-words">
                                {renderBody(m.body, !!m.body_masked, !!isMe)}
                              </div>
                            )}
                            {m.body_masked && (
                              <p className="mt-1.5 text-[11px] leading-snug text-[var(--sg-warn)]">
                                Nu este publicat sau nu mai este disponibil.
                              </p>
                            )}
                          </div>
                          {!m.deleted_at && (isAdmin || isMe) && (
                            <div className={`absolute top-1 transition-opacity ${isMe ? "-left-9" : "-right-9"} ${openMenuId === `message:${m.id}` ? "opacity-100" : "opacity-0 group-hover/message:opacity-100"}`}>
                              <button
                                type="button"
                                aria-label="Opțiuni mesaj"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(openMenuId === `message:${m.id}` ? null : `message:${m.id}`);
                                }}
                                className={`rounded-full p-1.5 transition-colors ${openMenuId === `message:${m.id}` ? "bg-paper text-ink" : "text-ink-faint hover:bg-paper hover:text-ink"}`}
                              >
                                <MoreHorizontal className="h-[18px] w-[18px]" />
                              </button>
                              {openMenuId === `message:${m.id}` && (
                                <div className={`absolute top-full mt-1 z-50 min-w-[140px] rounded-xl border border-rule bg-white p-1.5 shadow-xl ${isMe ? "left-0" : "right-0"}`} onClick={(e) => e.stopPropagation()}>
                                  {!m.body_masked && (
                                    <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-paper-sunk" onClick={() => { setOpenMenuId(null); startEdit(m.id, m.body ?? ""); }}>
                                      <Pencil className="h-4 w-4 text-ink-faint" /> Editează
                                    </button>
                                  )}
                                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)]" onClick={async () => { setOpenMenuId(null); if (await confirm({ title: "Ștergi mesajul?", description: "Mesajul va fi eliminat din conversație.", confirmText: "Șterge mesajul" })) await deleteMessage(m.id); }}>
                                    <Trash2 className="h-4 w-4 text-[var(--sg-danger)]" /> Șterge
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {!!m.images?.length && (
                        <div className={`grid w-64 gap-1 sm:w-72 ${m.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                          {m.images.map((image: ChatImage) => {
                            const imageKey = imageRetryKey(m.id, image);
                            if (unavailableImages.has(imageKey)) {
                              return <span key={image.path} className="col-span-full text-xs italic text-ink-faint">Imagine indisponibilă</span>;
                            }
                            return image.signedUrl ? (
                              <div key={image.path} className="group/image relative">
                              <button
                                type="button"
                                // `min-h` cât timp poza se încarcă: cu
                                // înălțime automată, bula ar porni de la
                                // zero și ar sări când imaginea se
                                // decodează, exact în momentul în care
                                // lista derulează la capăt.
                                className={`overflow-hidden rounded-xl bg-paper-sunk focus:outline-none focus:ring-2 focus:ring-[var(--sg-accent)] ${
                                  m.images!.length === 1 ? "min-h-32" : ""
                                }`}
                                onClick={() => setPreview({ messageId: m.id, image })}
                              >
                                <img
                                  src={image.signedUrl}
                                  alt={image.name}
                                  className={m.images!.length === 1
                                    ? "h-auto max-h-80 w-full object-cover"
                                    : "aspect-square w-full object-cover"}
                                  onError={() => { void requestImageRefresh(m.id, image); }}
                                />
                              </button>
                              {!m.deleted_at && (isAdmin || isMe) && (
                                <div className={`absolute top-1/2 -translate-y-1/2 transition-opacity ${isMe ? "-left-9" : "-right-9"} ${openMenuId === `image:${m.id}:${image.path}` ? "opacity-100" : "opacity-0 group-hover/image:opacity-100"}`}>
                                  <button
                                    type="button"
                                    aria-label={`Opțiuni pentru ${image.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(openMenuId === `image:${m.id}:${image.path}` ? null : `image:${m.id}:${image.path}`);
                                    }}
                                    className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-paper hover:text-ink"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                  {openMenuId === `image:${m.id}:${image.path}` && (
                                    <div className={`absolute top-full z-50 mt-1 min-w-[130px] rounded-xl border border-rule bg-white p-1.5 shadow-xl ${isMe ? "left-0" : "right-0"}`} onClick={(e) => e.stopPropagation()}>
                                      <button
                                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--sg-danger)] hover:bg-[var(--sg-danger-soft)]"
                                        onClick={async () => {
                                          setOpenMenuId(null);
                                          if (await confirm({ title: "Ștergi imaginea?", description: "Imaginea va fi eliminată din mesaj.", confirmText: "Șterge imaginea" })) {
                                            const item = await deleteImage(m.id, image.path);
                                            if (item && preview?.messageId === m.id && preview?.image.path === image.path) setPreview(null);
                                          }
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4 text-[var(--sg-danger)]" /> Șterge
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              </div>
                            ) : (
                              <span key={image.path} className="col-span-full text-xs text-ink-faint">Se încarcă imaginea...</span>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

            </div>
          </div>

          {/* 3. Ora (apare sub rândul cu avatar și bulă) */}
          {shouldShowMeta && (
            <div
              className={`mt-1 text-[10px] font-medium text-ink-faint flex items-center gap-1.5 ${
                isMe ? "justify-end mr-1" : "justify-start ml-10"
              }`}
            >
              <span>{formatTime(m.created_at)}</span>

              {isEdited && (
                  <span className="flex items-center gap-0.5 opacity-70">
                    <span className="w-0.5 h-0.5 rounded-full bg-rule-strong" />{" "}
                    Editat
                  </span>
                )}

              {readReceiptLabel && (
                <span className="flex items-center gap-0.5 opacity-70">
                  <span className="w-0.5 h-0.5 rounded-full bg-rule-strong" />{" "}
                  {readReceiptLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
      })}
    </>
  )
}
