/**
 * Ajutoarele de dată ale chatului: ziua, ora, separatorul de zi. Erau definite
 * în corpul lui `ProjectChatDrawer`, deci se recreau la fiecare randare și nu
 * puteau fi folosite de nimeni altcineva.
 */
export const toMs = (iso: string) => new Date(iso).getTime();
export const isSameDay = (aIso: string, bIso: string) => {
    const a = new Date(aIso);
    const b = new Date(bIso);
    return a.toDateString() === b.toDateString();
  };

export const formatDayLabel = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (isSameDay(iso, now.toISOString())) return "Astăzi";
    now.setDate(now.getDate() - 1);
    if (isSameDay(iso, now.toISOString())) return "Ieri";
    return d.toLocaleDateString("ro-RO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

export const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("ro-RO", {
      hour: "2-digit",
      minute: "2-digit",
    });
