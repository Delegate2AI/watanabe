import type { Metadata } from "next";
import { getConfig } from "@/lib/config";
import "./globals.css";

/**
 * Title and description come from `portal.yaml` (spec 16). `generateMetadata`
 * rather than a static `metadata` export, because the config is read at runtime:
 * a static object would be frozen at build time and could not track a value that
 * changes per deploy.
 */
export function generateMetadata(): Metadata {
  const { app } = getConfig();
  return { title: app.name, description: app.tagline };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `suppressHydrationWarning`: next-themes (spec 18 `(app)` shell) sets
  // `data-theme` on <html> from a pre-paint inline script, so the server-rendered
  // html and the first client render intentionally differ on that attribute.
  // This suppresses only that expected mismatch on <html> itself.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
