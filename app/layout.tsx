import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// Atkinson Hyperlegible was drawn for low-vision readers: distinct 0/O, 1/l/I,
// open counters. Farmers read this on a phone in sunlight; parcel ids are codes.
const sans = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
  adjustFontFallback: false
});

const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-mono",
  display: "swap",
  adjustFontFallback: false
});

export const metadata: Metadata = {
  title: "Zatrzymaj wodę – ocena wody na działce",
  description:
    "Sprawdź sytuację wodną działki rolnej i dowiedz się, jak zatrzymać wodę w glebie i krajobrazie."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F3F5F0"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
