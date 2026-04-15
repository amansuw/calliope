"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Download,
  ListMusic,
  BarChart3,
  Settings,
  Music2,
  HardDrive,
} from "lucide-react";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/library", label: "Library", icon: HardDrive },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 h-full w-56 flex-col border-r border-border bg-bg z-50">
        <Link
          href="/"
          className="flex items-center gap-2 px-5 py-5 group animate-fade-in"
        >
          <div className="relative">
            <div className="absolute inset-0 bg-primary/50 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <Music2 className="h-6 w-6 text-primary relative z-10 group-hover:animate-pulse-glow rounded-full" />
          </div>
          <span className="text-lg font-bold gradient-text">Calliope</span>
        </Link>

        <nav className="flex flex-col gap-1 px-3 mt-2">
          {links.map(({ href, label, icon: Icon }, idx) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-300 overflow-hidden ${
                  active
                    ? "text-primary"
                    : "text-muted-fg hover:text-fg"
                }`}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                {active && (
                  <div className="absolute inset-0 bg-primary/10 animate-fade-in" />
                )}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-0 bg-primary rounded-r transition-all duration-300 hover:h-6" />
                <Icon
                  className={`h-4 w-4 relative z-10 transition-transform duration-300 ${
                    active ? "scale-110" : "group-hover:scale-105"
                  }`}
                />
                <span className="relative z-10">{label}</span>
                {active && (
                  <div className="ml-auto w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Decorative glow at bottom */}
        <div className="mt-auto mx-auto mb-4 w-32 h-32 bg-primary/20 rounded-full blur-3xl opacity-50" />
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 flex border-t border-border bg-bg/80 backdrop-blur-md z-50">
        {links.map(({ href, label, icon: Icon }, idx) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-all duration-300 ${
                active
                  ? "text-primary"
                  : "text-muted-fg"
              }`}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              {active && (
                <div className="absolute inset-0 bg-primary/5 animate-fade-in" />
              )}
              <Icon className={`h-5 w-5 transition-transform duration-300 ${active ? "scale-110" : ""}`} />
              <span className="relative z-10">{label}</span>
              {active && (
                <div className="absolute top-1 w-1 h-1 rounded-full bg-primary animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
