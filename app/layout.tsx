import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar"; // <-- Importăm noul Navbar
import { AuthProvider } from './providers/AuthProvider'

const inter = Inter({ subsets: ["latin"], variable: '--font-inter' });

export const metadata: Metadata = {
  title: "Bonie | Project Management",
  description: "Platformă premium de management proiecte",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" className="h-full">
      <body className={`${inter.className} h-full bg-slate-50 text-slate-900 antialiased`}>
      <AuthProvider>
        {/* Navbar-ul Inteligent */}
        <Navbar />

        {/* Gradient decorativ */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-indigo-50/50 to-transparent opacity-60" />
        </div>

        {/* Main Content */}
        <main className="relative flex-1 pt-24 pb-12 min-h-screen z-10">
          <div className="max-w-7xl mx-auto px-6 lg:px-12">
            {children}
          </div>
        </main>
        </AuthProvider>
      </body>
    </html>
  );
}