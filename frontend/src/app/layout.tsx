import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
// Design System CSS is registered BEFORE globals.css so our own globals can
// override any DS defaults that conflict. Loose CSS cascade — later wins.
import "@navanta-ai/design-system/styles.css";
import "./globals.css";
import { ToastProvider, Toaster } from "@navanta-ai/design-system";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Allison · Navanta Lens",
  description: "Indirect procurement control tower for the Allison combination.",
};

// Lock to light — emits <meta name="color-scheme" content="light"> so the
// browser never renders native chrome / the canvas dark on an OS dark setting.
export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          {children}
          <Toaster position="top-right" />
        </ToastProvider>
      </body>
    </html>
  );
}
