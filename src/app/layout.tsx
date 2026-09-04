import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BENGAL-EYE C4ISR | Bangladesh Defense & OSINT Command",
  description: "Tactical Situational Awareness, Aerospace, Maritime & Orbital Reconnaissance Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-tactical-dark text-slate-100 antialiased h-screen w-screen overflow-hidden select-none">
        {children}
      </body>
    </html>
  );
}
