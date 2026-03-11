import type { Metadata } from "next";
import "./globals.css";
import "@/chemist-module/styles/chemist.css";
import ChatWidget from "@/chemist-module/ui/ChatWidget";

export const metadata: Metadata = {
  title: "UF Chemist | Industrial Laboratory Assistant",
  description: "Advanced chemical analysis and formulation system for United Formulas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
