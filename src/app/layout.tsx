import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prusa Pilot — Console Opérateur 3D",
  description:
    "Gestion locale du service pilote d'impression 3D avec inspection STL et intégration PrusaLink",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
