import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WINS人狼競馬メモ",
  description: "Discordの回顧メモから今週出走するメモ馬を自動抽出",
  openGraph: {
    title: "WINS人狼競馬メモ",
    description: "Discordの回顧メモから今週出走するメモ馬を自動抽出",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
