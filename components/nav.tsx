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

const links = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/library", label: "Library", icon: HardDrive },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 h-full w-56 flex-col border-r border-border bg-bg z-50">
        <Link href="/" className="flex items-center gap-2 px-5 py-5">
          <Music2 className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold">Calliope</span>
        </Link>

        <nav className="flex flex-col gap-1 px-3 mt-2">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-fg hover:bg-secondary hover:text-fg"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 flex border-t border-border bg-bg z-50">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors ${
                active
                  ? "text-primary"
                  : "text-muted-fg"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
