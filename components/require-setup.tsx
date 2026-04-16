"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ConfigStatus {
  configured: boolean;
  temp_dir?: string;
  music_dir?: string;
}

export function RequireSetup({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data: ConfigStatus) => {
        if (!data.configured) {
          router.replace("/setup");
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        router.replace("/setup");
      });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-muted-fg">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
}