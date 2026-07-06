/**
 * Rotating example placeholders: every form shows a different, realistic
 * example each time (and cycles while the field is empty), instead of one
 * frozen sample value.
 */

import { useEffect, useState } from "react";

export const placeholderPools = {
  subscription: ["Netflix", "Spotify", "YouTube Premium", "iCloud", "Elektrik", "Doğalgaz", "Su", "İnternet", "Telefon", "Amazon Prime", "ChatGPT", "BluTV"],
  installment: ["Telefon", "Dizüstü bilgisayar", "Beyaz eşya", "Konut kredisi", "Mobilya", "Tatil", "Araç kasko taksidi"],
  category: ["Market", "Ulaşım", "Faturalar", "Eğlence", "Sağlık", "Eğitim", "Giyim", "Kira"],
  person: ["Eşim", "Annem", "Kardeşim", "Ev arkadaşım"],
  income: ["Maaş", "Kira geliri", "Freelance", "Prim", "Burs"],
  source: ["Banka kartım", "Kredi kartım", "Nakit", "Dijital cüzdan", "Ortak hesap"],
  note: ["Market alışverişi", "Doğum günü hediyesi", "Yıllık ödeme", "Arkadaşlarla yemek", "İade bekleniyor"],
} as const;

const ROTATE_MS = 4000;

/** A placeholder from the pool that starts at a random spot and keeps cycling. */
export function useRotatingPlaceholder(pool: readonly string[]): string {
  const [start] = useState(() => Math.floor(Math.random() * pool.length));
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setOffset((o) => o + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);
  return `Ör. ${pool[(start + offset) % pool.length]}`;
}
