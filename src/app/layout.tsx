import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VisionAid — experimental visual assistant",
  description:
    "An experimental accessibility assistant: take one photo, ask a question by voice or text, and hear the answer. Not a navigation, safety or medical tool.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-foreground"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
