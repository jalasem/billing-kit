import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "billing-kit",
  description: "Production-grade billing for Next.js and Postgres.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
