import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import TerminalToggle from "@/components/TerminalToggle";
import WorkTimerBar from "@/components/WorkTimerBar";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Integrity Sprint Log",
  description: "Sprint tracker & OpenProject sync for Integrity's team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><I18nProvider>{children}</I18nProvider><TerminalToggle /><WorkTimerBar /></body>
    </html>
  );
}
