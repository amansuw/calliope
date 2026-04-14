import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Calliope",
  description: "Music downloader — Spotify & YouTube Music",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-fg">
        <Nav />
        <main className="pb-20 md:pb-6 md:pl-56">
          <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
