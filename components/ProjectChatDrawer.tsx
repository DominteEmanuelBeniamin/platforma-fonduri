"use client";

/* eslint-disable @next/next/no-img-element -- Chat images use short-lived signed/blob URLs and intentionally bypass Next optimization. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Send,
  X,
  Pencil,
  Trash2,
  MoreHorizontal,
  ImagePlus,
  Link2,
  Download,
  EyeOff,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import * as Dialog from '@radix-ui/react-dialog';
import { useAuth } from "@/app/providers/AuthProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useProjectChat } from "@/hooks/useProjectChat";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { FeedbackMessage } from "@/components/FeedbackMessage";
import UnifiedSearchDialog from "@/components/UnifiedSearchDialog";
import type { SearchResult } from "@/lib/projectSearch";
import { reconcileProjectChatComposerSuccess } from "@/lib/project-chat-composer";
import { buildProjectChatHref, splitProjectChatBody, UNRESOLVED_LINK_TEXT } from "@/lib/project-chat-links";
import { PROJECT_CHAT_MAX_IMAGES, PROJECT_CHAT_MAX_IMAGE_BYTES } from "@/lib/project-chat-contracts";
import type { ChatImage } from "@/lib/project-chat-contracts";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  projectId: string;
  onUnreadCountChange?: (count: number) => void;
  searchIndex?: SearchResult[];
  onNavigate?: (result: SearchResult) => void;
};

type PendingImage = {
  id: string;
  file: File;
  name: string;
  mimeType: ChatImage['mimeType'];
  previewUrl: string;
};

type ImageUpload = {
  clientFileId: number;
  path: string;
  signedUploadUrl: string;
  token: string;
  mimeType?: ChatImage['mimeType'];
};

type SendAttemptPhase = 'initializing' | 'uploading' | 'posting' | 'settled';

type SendAttempt = {
  id: string;
  projectId: string;
  phase: SendAttemptPhase;
  controller: AbortController;
  attachments: PendingImage[];
  initializedPaths: string[];
  cleanupPromise: Promise<void> | null;
  settled: Promise<void>;
  resolveSettled: () => void;
};

const createSendAttempt = (projectId: string, attachments: PendingImage[]): SendAttempt => {
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  return {
    id: crypto.randomUUID(),
    projectId,
    phase: 'initializing',
    controller: new AbortController(),
    attachments: attachments.slice(),
    initializedPaths: [],
    cleanupPromise: null,
    settled,
    resolveSettled,
  };
};

const IMAGE_MIMES: Record<string, ChatImage['mimeType']> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

const IMAGE_EXTENSIONS: Record<string, ChatImage['mimeType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const extensionMime = (name: string) => IMAGE_EXTENSIONS[name.split('.').pop()?.toLowerCase() ?? ''];
const imageRetryKey = (messageId: string, image: ChatImage) =>
  `${messageId}:${image.path}:${image.signedUrl ?? ''}:${image.signedUrlExpiresAt ?? ''}`;

export default function ProjectChatDrawer({
  open,
  onClose,
  title = "Chat proiect",
  projectId,
  onUnreadCountChange,
  searchIndex = [],
  onNavigate,
}: Props) {
  const { loading: authLoading, userId, profile, apiFetch, token } = useAuth();
  const { confirm } = useToast();
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
    refreshMessage,
  } = useProjectChat(projectId, { initialLimit: 50 });

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingImage[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [showRequestCta, setShowRequestCta] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Câte imagini s-au urcat din câte, cât ține trimiterea. */
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState<'all' | 'document_request'>('all');
  const [preview, setPreview] = useState<{ messageId: string; image: ChatImage } | null>(null);
  const [unavailableImages, setUnavailableImages] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    setIsMounted(true);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [initialReadBoundary, setInitialReadBoundary] = useState<string | null>(null);

  const prevScrollHeightRef = useRef<number | null>(null);
  const openBoundaryCapturedRef = useRef(false);
  const userPinnedToBottomRef = useRef(true);
  const imageRetryRef = useRef<Set<string>>(new Set());
  const textRef = useRef('');
  const attachmentsRef = useRef<PendingImage[]>([]);
  const activeAttemptRef = useRef<SendAttempt | null>(null);
  const closePromiseRef = useRef<Promise<void> | null>(null);

  const canSend = !authLoading && !sending && !uploading && (text.trim().length > 0 || attachments.length > 0);

  const cleanupPaths = useCallback(async (paths: string[], targetProjectId = projectId) => {
    if (!paths.length) return;
    try {
      await apiFetch(`/api/projects/${targetProjectId}/chat/images/cleanup`, {
        method: 'POST',
        body: JSON.stringify({ paths }),
      });
    } catch {
      // Cleanup is deliberately best effort; the server prefix sweep is the fallback.
    }
  }, [apiFetch, projectId]);

  // `cleanupPaths` depinde de `apiFetch`, care depinde de `token`. Ținut în
  // dependențele efectului de mai jos, o reînnoire de sesiune (orară) ar fi
  // golit composerul sub degetele userului și ar fi șters din bucket imaginile
  // deja urcate. Resetarea ține strict de schimbarea proiectului.
  const cleanupPathsRef = useRef(cleanupPaths);
  useEffect(() => {
    cleanupPathsRef.current = cleanupPaths;
  }, [cleanupPaths]);

  const cleanupAttemptPaths = useCallback((attempt: SendAttempt) => {
    if (!attempt.cleanupPromise) {
      const paths = [...new Set(attempt.initializedPaths)];
      attempt.cleanupPromise = cleanupPathsRef.current(paths, attempt.projectId);
    }
    return attempt.cleanupPromise;
  }, []);

  useEffect(() => {
    textRef.current = '';
    attachmentsRef.current = [];
    setAttachments([]);
    setText('');
    setPreview(null);
    setComposerError(null);
    setShowRequestCta(false);
    return () => {
      const attempt = activeAttemptRef.current;
      if (attempt?.projectId === projectId) {
        activeAttemptRef.current = null;
        // The project can change without going through `closeDrawer`. Preserve
        // the same commit-safety rule here: only pre-POST work is abortable.
        if (attempt.phase !== 'posting') attempt.controller.abort();
        void attempt.settled;
      }
      const items = attachmentsRef.current;
      items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      attachmentsRef.current = [];
    };
  }, [projectId]);

  const closeDrawer = useCallback(() => {
    if (closePromiseRef.current) return closePromiseRef.current;

    const closePromise = (async () => {
      const attempt = activeAttemptRef.current;
      if (attempt && attempt.phase !== 'settled') {
        // Once the POST has started, aborting the browser request cannot prove
        // the server did not commit it. Let it settle; uploads are safe to
        // abort because their paths are owned by this attempt and cleaned up.
        if (attempt.phase !== 'posting') attempt.controller.abort();
        await attempt.settled;
      }
      onClose();
    })().finally(() => {
      if (closePromiseRef.current === closePromise) closePromiseRef.current = null;
    });

    closePromiseRef.current = closePromise;
    return closePromise;
  }, [onClose]);

  const addFiles = (incoming: File[]) => {
    if (!incoming.length || activeAttemptRef.current || uploading || sending) return;
    setComposerError(null);
    setShowRequestCta(false);

    const currentAttachments = attachmentsRef.current;
    if (currentAttachments.length + incoming.length > PROJECT_CHAT_MAX_IMAGES) {
      setComposerError(`Poți atașa maximum ${PROJECT_CHAT_MAX_IMAGES} imagini într-un mesaj.`);
      return;
    }

    const valid: PendingImage[] = [];
    for (const file of incoming) {
      const lowerName = file.name.toLowerCase();
      if (file.type === 'image/svg+xml' || lowerName.endsWith('.svg')) {
        setComposerError('Imaginile SVG nu sunt acceptate. Folosește PNG, JPEG, WebP sau GIF.');
        continue;
      }
      const mimeType = IMAGE_MIMES[file.type] ?? (file.type ? undefined : extensionMime(file.name));
      if (!mimeType) {
        setComposerError('Documentele se încarcă prin cererile dedicate.');
        setShowRequestCta(true);
        continue;
      }
      if (file.size > PROJECT_CHAT_MAX_IMAGE_BYTES) {
        setComposerError('Imaginea depășește limita de 10 MB.');
        continue;
      }
      if (file.size < 1) {
        setComposerError('Imaginea nu este validă.');
        continue;
      }
      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        mimeType,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (valid.length) {
      const next = currentAttachments.concat(valid);
      attachmentsRef.current = next;
      setAttachments(next);
    }
  };

  const removeAttachment = (id: string) => {
    const item = attachmentsRef.current.find((entry) => entry.id === id);
    if (!item) return;
    URL.revokeObjectURL(item.previewUrl);
    const next = attachmentsRef.current.filter((entry) => entry.id !== id);
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const openDocumentRequestSearch = () => {
    setSearchFilter('document_request');
    setSearchOpen(true);
  };

  const handleSearchSelect = async (result: SearchResult) => {
    if (searchFilter === 'all') {
      const href = buildProjectChatHref(projectId, result);
      const textarea = textareaRef.current;
      const currentText = textRef.current;
      const start = textarea?.selectionStart ?? currentText.length;
      const end = textarea?.selectionEnd ?? start;
      const before = currentText.slice(0, start);
      const after = currentText.slice(end);
      const prefix = before && !/\s$/.test(before) ? ' ' : '';
      const suffix = after && !/^\s/.test(after) ? ' ' : '';
      const nextText = `${before}${prefix}${href}${suffix}${after}`;
      textRef.current = nextText;
      setText(nextText);
      setSearchOpen(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
      return;
    }
    setSearchOpen(false);
    await closeDrawer();
    onNavigate?.(result);
  };

  const requestImageRefresh = useCallback(async (messageId: string, image: ChatImage) => {
    const key = imageRetryKey(messageId, image);
    if (imageRetryRef.current.has(key)) {
      setUnavailableImages((prev) => new Set(prev).add(key));
      return null;
    }
    imageRetryRef.current.add(key);
    const item = await refreshMessage(messageId);
    const refreshedImage = item?.images?.find((entry) => entry.path === image.path) ?? null;
    if (!refreshedImage?.signedUrl) {
      setUnavailableImages((prev) => new Set(prev).add(key));
      return null;
    }
    setPreview((current) => (
      current?.messageId === messageId && current.image.path === image.path
        ? { ...current, image: refreshedImage }
        : current
    ));
    setUnavailableImages((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    return refreshedImage;
  }, [refreshMessage]);

  useEffect(() => {
    for (const message of messages) {
      for (const image of message.images ?? []) {
        if (!image.signedUrl) void requestImageRefresh(message.id, image);
      }
    }
  }, [messages, requestImageRefresh]);

  useEffect(() => {
    setPreview((current) => {
      if (!current) return current;
      const message = messages.find((entry) => entry.id === current.messageId);
      const image = message?.images?.find((entry) => entry.path === current.image.path);
      if (!image) return null;
      if (image.signedUrl === current.image.signedUrl && image.signedUrlExpiresAt === current.image.signedUrlExpiresAt) return current;
      return { ...current, image };
    });
  }, [messages]);

  const renderBody = (body: string | null, masked = false, isOwn = false) => {
    if (!body) return null;
    const unavailableReference = (key: string | number) => (
      <span
        key={key}
        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-100/80 px-1.5 py-0.5 text-xs font-semibold text-amber-800"
      >
        <EyeOff className="h-3 w-3 shrink-0" aria-hidden="true" />
        Element indisponibil
      </span>
    );
    const parts = splitProjectChatBody(body, projectId);
    return parts.map((part, index) => {
      if (part.kind === 'text') {
        if (!masked || !part.text.includes(UNRESOLVED_LINK_TEXT)) return <span key={index}>{part.text}</span>;
        return (
          <span key={index}>
            {part.text.split(UNRESOLVED_LINK_TEXT).map((fragment, fragmentIndex) => (
              <span key={fragmentIndex}>
                {fragmentIndex > 0 && unavailableReference(`${index}-${fragmentIndex}`)}
                {fragment}
              </span>
            ))}
          </span>
        );
      }
      // Rezolvat după id, nu după egalitate de href: href-ul e scris o dată și
      // îngheață poziția de atunci, iar o mutare a activității sau a cererii ar
      // face chip-ul „Element indisponibil” pentru un element care există.
      // Navigarea folosește tot `result`, deci pleacă din poziția de acum.
      const result = searchIndex.find(
        (entry) => entry.type === part.reference.type && entry.id === part.reference.id,
      );
      if (!result) return unavailableReference(index);
      const typeLabel = result.type === 'phase' ? 'Fază' : result.type === 'activity' ? 'Activitate' : 'Cerere';
      return (
        <button
          key={index}
          type="button"
          onClick={async (event) => {
            event.stopPropagation();
            await closeDrawer();
            onNavigate?.(result);
          }}
          className={`group/link inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
            isOwn
              ? 'border-white/15 bg-white/10 text-indigo-100 hover:bg-white/15'
              : 'border-indigo-200/80 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
          }`}
          title={`${result.type}: ${result.title}`}
        >
          <Link2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide opacity-65">{typeLabel}</span>
          <span className="truncate font-semibold">{result.title}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-50 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" aria-hidden="true" />
        </button>
      );
    });
  };

  /** Pozele mesajului deschis în lightbox, ca să te poți plimba prin ele. */
  const previewSiblings = useMemo(() => {
    if (!preview) return [];
    return messages.find((m) => m.id === preview.messageId)?.images ?? [];
  }, [messages, preview]);
  const previewIndex = preview
    ? previewSiblings.findIndex((image) => image.path === preview.image.path)
    : -1;

  const stepPreview = useCallback((delta: number) => {
    setPreview((current) => {
      if (!current) return current;
      const siblings = messages.find((m) => m.id === current.messageId)?.images ?? [];
      if (siblings.length < 2) return current;
      const index = siblings.findIndex((image) => image.path === current.image.path);
      if (index < 0) return current;
      const next = (index + delta + siblings.length) % siblings.length;
      return { ...current, image: siblings[next] };
    });
  }, [messages]);

  const downloadImage = async (messageId: string, image: ChatImage, retried = false) => {
    let current = image;
    if (!current.signedUrl) {
      const refreshed = await requestImageRefresh(messageId, current);
      if (!refreshed) return;
      current = refreshed;
    }
    try {
      const response = await fetch(current.signedUrl as string);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = current.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      if (retried) {
        setUnavailableImages((prev) => new Set(prev).add(imageRetryKey(messageId, current)));
        return;
      }
      const refreshed = await requestImageRefresh(messageId, current);
      if (refreshed) await downloadImage(messageId, refreshed, true);
      else setUnavailableImages((prev) => new Set(prev).add(imageRetryKey(messageId, current)));
    }
  };

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
    setEditingId(id);
    setEditText(currentBody ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (id: string) => {
    const item = await editMessage(id, editText);
    if (item) cancelEdit();
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
      if (preview && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        stepPreview(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
      if (e.key !== "Escape") return;
      // În captură, deci înaintea oricui altcuiva. O apăsare de Escape închidea
      // și lightbox-ul, și tot chatul: Radix își trata singur evenimentul,
      // React reabona sincron listenerul de aici, iar acesta prindea aceeași
      // apăsare, de data asta cu starea deja golită. Aici starea e sigur cea
      // dinainte, iar `stopPropagation` nu-l mai lasă pe Radix să acționeze
      // a doua oară.
      if (searchOpen) {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(false);
        return;
      }
      if (preview) {
        e.preventDefault();
        e.stopPropagation();
        setPreview(null);
        return;
      }
      if (!editingId) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, closeDrawer, editingId, preview, searchOpen, stepPreview]);

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
    if (!canSend || activeAttemptRef.current) return;

    const attempt = createSendAttempt(projectId, attachmentsRef.current);
    activeAttemptRef.current = attempt;
    setUploading(true);
    setComposerError(null);
    setUploadProgress(attempt.attachments.length ? { done: 0, total: attempt.attachments.length } : null);

    const assertActive = () => {
      if (
        attempt.controller.signal.aborted ||
        activeAttemptRef.current?.id !== attempt.id
      ) {
        const error = new Error('Project chat send attempt aborted');
        error.name = 'AbortError';
        throw error;
      }
    };

    try {
      let references: { path: string; name: string }[] = [];
      if (attempt.attachments.length) {
        const initResponse = await apiFetch(`/api/projects/${projectId}/chat/images/init`, {
          method: 'POST',
          body: JSON.stringify({
            files: attempt.attachments.map(({ name, file, mimeType }) => ({ name, size: file.size, type: mimeType })),
          }),
          signal: attempt.controller.signal,
        });
        const initJson = await initResponse.json().catch(() => null) as { uploads?: ImageUpload[] } | null;
        const receivedUploads = Array.isArray(initJson?.uploads) ? initJson.uploads : [];

        // The init response owns every returned path. Record the entire batch
        // before validating it or starting the first PUT so every failure path
        // can clean the complete allocation exactly once.
        attempt.initializedPaths = receivedUploads
          .map(upload => upload?.path)
          .filter((path): path is string => typeof path === 'string' && path.length > 0);

        if (!initResponse.ok || receivedUploads.length !== attempt.attachments.length) {
          throw new Error('upload init failed');
        }
        const uploads = receivedUploads.slice().sort((a, b) => a.clientFileId - b.clientFileId);
        if (new Set(attempt.initializedPaths).size !== uploads.length) {
          throw new Error('upload init failed');
        }
        for (const [index, upload] of uploads.entries()) {
          if (
            upload.clientFileId !== index ||
            !upload.path ||
            !upload.signedUploadUrl ||
            !attempt.attachments[index]
          ) {
            throw new Error('upload init failed');
          }
        }

        assertActive();
        attempt.phase = 'uploading';
        for (const [index, upload] of uploads.entries()) {
          assertActive();
          const attachment = attempt.attachments[index];
          const putResponse = await fetch(upload.signedUploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': upload.mimeType ?? attachment.mimeType,
              Authorization: `Bearer ${upload.token || token || ''}`,
            },
            body: attachment.file,
            signal: attempt.controller.signal,
          });
          if (!putResponse.ok) throw new Error('upload failed');
          assertActive();
          if (mountedRef.current) setUploadProgress({ done: index + 1, total: uploads.length });
        }
        references = uploads.map((upload, index) => ({
          path: upload.path,
          name: attempt.attachments[index].name,
        }));
      }

      assertActive();
      attempt.phase = 'posting';
      const sentText = textRef.current;
      if (mountedRef.current) {
        setUploading(false);
        setUploadProgress(null);
      }

      // Eșecul trimiterii e raportat de hook prin `error`; dacă l-am dubla aici
      // cu `composerError`, userul ar vedea două mesaje diferite pentru același
      // eșec. `composerError` rămâne strict pentru partea de upload.
      const item = await sendMessage(
        { body: sentText, images: references },
        { signal: attempt.controller.signal },
      );
      if (!item) {
        await cleanupAttemptPaths(attempt);
        return;
      }

      const reconciliation = reconcileProjectChatComposerSuccess({
        attemptId: attempt.id,
        activeAttemptId: activeAttemptRef.current?.id ?? null,
        sentText,
        currentText: textRef.current,
        sentAttachmentIds: attempt.attachments.map(attachment => attachment.id),
        currentAttachmentIds: attachmentsRef.current.map(attachment => attachment.id),
      });
      if (!reconciliation) return;

      const remainingIds = new Set(reconciliation.attachmentIds);
      const currentAttachments = attachmentsRef.current;
      currentAttachments
        .filter(attachment => !remainingIds.has(attachment.id))
        .forEach(attachment => URL.revokeObjectURL(attachment.previewUrl));
      const remainingAttachments = currentAttachments.filter(attachment => remainingIds.has(attachment.id));

      textRef.current = reconciliation.text;
      attachmentsRef.current = remainingAttachments;
      if (mountedRef.current) {
        setText(reconciliation.text);
        setAttachments(remainingAttachments);
      }
      setTimeout(() => scrollToBottom(false), 0);
    } catch {
      await cleanupAttemptPaths(attempt);
      if (
        mountedRef.current &&
        activeAttemptRef.current?.id === attempt.id &&
        !attempt.controller.signal.aborted &&
        attempt.phase !== 'posting'
      ) {
        setComposerError('Nu am putut încărca imaginile. Reîncearcă.');
      }
    } finally {
      attempt.phase = 'settled';
      if (activeAttemptRef.current?.id === attempt.id) {
        activeAttemptRef.current = null;
        if (mountedRef.current) {
          setUploading(false);
          setUploadProgress(null);
        }
      }
      attempt.resolveSettled();
    }
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
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
        onClick={closeDrawer}
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm cursor-default"
      />

      {/* Drag & drop pe tot drawerul, nu doar pe lista de mesaje: ținta
          intuitivă e composerul, iar acolo un drop fără handler ar fi lăsat
          browserul să navigheze la fișier și să piardă mesajul scris. */}
      <aside
        onDragEnter={(event) => {
          event.preventDefault();
          if (!uploading && !sending) setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className="absolute right-0 top-0 h-full w-full sm:w-[min(520px,90vw)] bg-white shadow-2xl flex flex-col sm:rounded-l-2xl overflow-hidden animate-in slide-in-from-right duration-300"
      >
        <div className="z-10 bg-white/80 backdrop-blur-md border-b border-slate-100 pt-[env(safe-area-inset-top)]">
          <div className="h-16 px-4 flex items-center justify-between">
            <button
              onClick={closeDrawer}
              aria-label="Înapoi"
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
              onClick={closeDrawer}
              aria-label="Închide chatul"
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
          {dragActive && (
            <div className="pointer-events-none sticky top-2 z-20 mb-2 rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50/95 p-6 text-center text-sm font-semibold text-indigo-700">
              Lasă imaginile aici
            </div>
          )}
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

          {error && <FeedbackMessage variant="error" className="mb-4">{error}</FeedbackMessage>}

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
                        {/* Textul și pozele sunt două elemente distincte, nu un
                            singur bloc: o poză înghesuită în bula de text arăta
                            ca un atașament al ei, nu ca o imagine de sine
                            stătătoare. Meniul „⋯" și marcajele rămân pe grup. */}
                        <div
                          onContextMenu={(e) => {
                            if (window.innerWidth < 640) {
                              e.preventDefault();
                              setOpenMenuId(m.id);
                            }
                          }}
                          className={`flex flex-col gap-1.5 ${isMe ? "items-end" : "items-start"}`}
                        >
                          {m.deleted_at ? (
                            <div
                              className={`px-4 py-2.5 text-[14px] leading-relaxed ${
                                isMe ? "bg-slate-900" : "border border-slate-100 bg-white shadow-sm"
                              } ${bubbleRadius}`}
                            >
                              <span className="italic text-slate-400/80 text-sm">
                                Acest mesaj a fost șters.
                              </span>
                            </div>
                          ) : (
                            <>
                              {isEditing ? (
                                // Doar bula de text e înlocuită: editai un mesaj
                                // cu poze fără să mai vezi la ce se referă.
                                <div className="w-full min-w-[280px] overflow-hidden rounded-2xl border-2 border-slate-900 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-200">
                                  <textarea
                                    autoFocus
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    className="w-full resize-none bg-transparent px-4 py-3 text-[14px] text-slate-800 focus:outline-none min-h-[100px]"
                                  />
                                  <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-2">
                                    <button
                                      onClick={cancelEdit}
                                      className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-200"
                                    >
                                      Anulează
                                    </button>
                                    <button
                                      onClick={() => saveEdit(m.id)}
                                      disabled={!editText.trim() && !m.images?.length}
                                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-md hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900"
                                    >
                                      Salvează
                                    </button>
                                  </div>
                                </div>
                              ) : (m.body || m.body_masked) && (
                                <div
                                  className={`px-4 py-2.5 text-[14px] leading-relaxed transition-colors ${
                                    m.body_masked
                                      ? "border border-amber-200 bg-amber-50 text-slate-700"
                                      : isMe
                                      ? "bg-slate-900 text-white"
                                      : "border border-slate-100 bg-white text-slate-800 shadow-sm"
                                  } ${bubbleRadius}`}
                                >
                                  {m.body && (
                                    <div className="whitespace-pre-wrap break-words">
                                      {renderBody(m.body, !!m.body_masked, !!isMe)}
                                    </div>
                                  )}
                                  {m.body_masked && (
                                    <p className="mt-1.5 text-[11px] leading-snug text-amber-800/75">
                                      Nu este publicat sau nu mai este disponibil.
                                    </p>
                                  )}
                                </div>
                              )}
                              {!!m.images?.length && (
                                <div className={`grid w-64 gap-1 sm:w-72 ${m.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                  {m.images.map((image) => {
                                    const imageKey = imageRetryKey(m.id, image);
                                    if (unavailableImages.has(imageKey)) {
                                      return <span key={image.path} className="col-span-full text-xs italic text-slate-400">Imagine indisponibilă</span>;
                                    }
                                    return image.signedUrl ? (
                                      <button
                                        key={image.path}
                                        type="button"
                                        // `min-h` cât timp poza se încarcă: cu
                                        // înălțime automată, bula ar porni de la
                                        // zero și ar sări când imaginea se
                                        // decodează, exact în momentul în care
                                        // lista derulează la capăt.
                                        className={`overflow-hidden rounded-xl bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
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
                                    ) : (
                                      <span key={image.path} className="col-span-full text-xs text-slate-400">Se încarcă imaginea...</span>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}
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
                                {/* Un mesaj poate rămâne legitim fără text (doar
                                    imagini). Condiționat pe `m.body`, butonul ar
                                    fi dispărut definitiv și n-ai mai fi putut
                                    adăuga text înapoi. */}
                                {!m.body_masked && (
                                  <button
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg hover:bg-slate-50 text-slate-700"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      startEdit(m.id, m.body ?? "");
                                    }}
                                  >
                                    <Pencil className="w-4 h-4 text-slate-400" />{" "}
                                    Editează
                                  </button>
                                )}
                                <button
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg hover:bg-rose-50 text-rose-600"
                                  onClick={async () => {
                                    setOpenMenuId(null);
                                    if (await confirm({ title: "Ștergi mesajul?", description: "Mesajul va fi eliminat din conversație.", confirmText: "Șterge mesajul" }))
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
          {!!attachments.length && (
            <div className="mb-2 flex gap-2 overflow-x-auto px-1">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative shrink-0">
                  <img src={attachment.previewUrl} alt={attachment.name} className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />
                  <button
                    type="button"
                    aria-label={`Elimină ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                    disabled={uploading || sending}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-900 p-0.5 text-white disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {uploadProgress && uploadProgress.total > 0 && (
            <p className="mb-2 px-1 text-xs text-slate-500" role="status">
              Se încarcă {Math.min(uploadProgress.done + 1, uploadProgress.total)} din {uploadProgress.total}…
            </p>
          )}
          {composerError && (
            <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <p>{composerError}</p>
              {showRequestCta && (
                <button type="button" onClick={openDocumentRequestSearch} className="mt-1 font-semibold underline">
                  Alege cererea potrivită
                </button>
              )}
            </div>
          )}
          <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-[20px] p-1.5 focus-within:ring-2 focus-within:ring-slate-900/10 focus-within:bg-white focus-within:border-slate-300 transition-all shadow-sm">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              disabled={uploading || sending}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label="Adaugă imagini"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || sending}
              className="mb-0.5 rounded-full p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-40"
            >
              <ImagePlus className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Inserează link intern"
              onClick={() => { setSearchFilter('all'); setSearchOpen(true); }}
              disabled={uploading || sending || !searchIndex.length}
              className="mb-0.5 rounded-full p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-40"
            >
              <Link2 className="h-5 w-5" />
            </button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                textRef.current = e.target.value;
                setText(e.target.value);
              }}
              onKeyDown={onTextareaKeyDown}
              onPaste={(event) => {
                const fileItems = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file');
                if (!fileItems.length) return;
                const pasted = fileItems
                  .filter((item) => item.type.startsWith('image/'))
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => !!file);
                event.preventDefault();
                if (pasted.length) addFiles(pasted);
                if (fileItems.some((item) => !item.type.startsWith('image/'))) {
                  setComposerError('Documentele se încarcă prin cererile dedicate.');
                  setShowRequestCta(true);
                }
              }}
              placeholder="Scrie un mesaj..."
              className="flex-1 bg-transparent resize-none px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none max-h-[120px]"
              rows={1}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={`h-[38px] px-4 rounded-2xl flex-shrink-0 flex items-center gap-2 text-sm font-semibold transition-all mb-0.5 mr-0.5 ${
                canSend
                  ? "bg-slate-900 text-white shadow-md hover:bg-slate-800 hover:scale-[1.02] active:scale-95"
                  : "bg-transparent text-slate-300 cursor-not-allowed"
              }`}
            >
              {sending || uploading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-[18px] h-[18px]" />
              )}
              <span className="hidden sm:inline-block">Trimite</span>
            </button>
          </div>
        </div>
      </aside>
      <Dialog.Root open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[1000000] bg-slate-900/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[1000001] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-white p-3 shadow-2xl focus:outline-none sm:max-h-[94vh] sm:w-[calc(100%-2rem)] sm:rounded-2xl sm:p-4">
            <Dialog.Title className="mb-2 truncate pr-8 text-sm font-semibold text-slate-900 sm:mb-3">
              {preview?.image.name ?? 'Imagine'}
              {previewSiblings.length > 1 && previewIndex >= 0 && (
                <span className="ml-2 font-normal text-slate-400">
                  {previewIndex + 1} din {previewSiblings.length}
                </span>
              )}
            </Dialog.Title>
            <Dialog.Description className="sr-only">Previzualizare imagine din chat</Dialog.Description>
            {preview && preview.image.signedUrl && !unavailableImages.has(imageRetryKey(preview.messageId, preview.image)) ? (
              <div className="relative">
                <img
                  src={preview.image.signedUrl}
                  alt={preview.image.name}
                  className="mx-auto max-h-[calc(100dvh-7rem)] w-auto max-w-full object-contain sm:max-h-[calc(94vh-7.5rem)]"
                  onError={() => { void requestImageRefresh(preview.messageId, preview.image); }}
                />
                {previewSiblings.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Imaginea anterioară"
                      onClick={() => stepPreview(-1)}
                      className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/60 p-2 text-white transition-colors hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-white"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Imaginea următoare"
                      onClick={() => stepPreview(1)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/60 p-2 text-white transition-colors hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-white"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-slate-500">Imagine indisponibilă</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Închide</button>
              </Dialog.Close>
              {preview && (
                <button
                  type="button"
                  onClick={() => void downloadImage(preview.messageId, preview.image)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <Download className="h-4 w-4" /> Descarcă
                </button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <UnifiedSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        index={searchFilter === 'document_request' ? searchIndex.filter((result) => result.type === 'document_request') : searchIndex}
        onSelect={handleSearchSelect}
        title={searchFilter === 'document_request' ? 'Alege cererea potrivită' : 'Inserează link intern'}
        description="Caută în elementele proiectului"
      />
    </div>
  );

  return createPortal(drawerContent, document.body);
}
