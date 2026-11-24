import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skóli lífsins",
  description: "Námskeið fyrir ungt fólk sem er að stíga sín fyrstu skref á vinnumarkaði.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="is">
      <body>{children}</body>
    </html>
  );
}
