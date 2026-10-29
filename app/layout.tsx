import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Navbar from "@/components/Navbar";
import AppContent from "@/components/AppContent";
import { AuthProvider } from './providers/AuthProvider'
import { ProjectChatUnreadProvider } from './providers/ProjectChatUnreadProvider'
import { NotificationsProvider } from './providers/NotificationsProvider'
import { ToastProvider } from './providers/ToastProvider'
import TooltipLayer from '@/components/ui/TooltipLayer'

// O singură familie în toată clădirea, ca într-un program de semnalizare
// adevărat. Atkinson Hyperlegible Next e desenat anume ca 1/I/l și 0/O să nu
// se confunde — exact ce cere un produs plin de numere de proiect și termene.
//
// Fișierele stau în `app/fonts/`, nu se descarcă de nicăieri: `next/font/google`
// a oprit livrarea când CDN-ul lor a răspuns 404. Două subseturi, 53 KB în
// total; `latin` aduce î â, `latin-ext` aduce ș ț ă.
const signage = localFont({
  src: [
    { path: "./fonts/AtkinsonHyperlegibleNext-latin.woff2", weight: "200 800", style: "normal" },
    { path: "./fonts/AtkinsonHyperlegibleNext-latin-ext.woff2", weight: "200 800", style: "normal" },
  ],
  variable: "--font-signage",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Bonie | Management de proiecte de finanțare",
  description: "Documentele, termenele și discuția fiecărui proiect de finanțare, într-un singur fir.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" className={`${signage.variable} h-full overflow-x-clip`}>
      {/* `min-h-full`, nu `h-full`: navigarea e `sticky` în body, iar un body
          înalt fix cât ecranul o lăsa să plece după primul ecran derulat. */}
      <body className="min-h-full bg-paper text-ink antialiased overflow-x-clip">
        <ToastProvider>
        <AuthProvider>
          <NotificationsProvider>
          <ProjectChatUnreadProvider>
            {/* Prima oprire pentru tastatură: săritul peste semnalizare,
                direct la conținut. WCAG 2.4.1. */}
            <a href="#continut" className="skip-link">Sari la conținut</a>

            <Navbar />

            <AppContent>{children}</AppContent>
          </ProjectChatUnreadProvider>
          </NotificationsProvider>
        </AuthProvider>
        </ToastProvider>
        {/* Tooltip-urile tuturor butoanelor — un singur strat, vezi componenta. */}
        <TooltipLayer />
      </body>
    </html>
  );
}
