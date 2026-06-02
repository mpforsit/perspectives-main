/**
 * Deterministic mock-data generator for the grid dev harness. Seeded by row
 * index so the same i always produces the same row — pagination, sort, and
 * "reach end" all behave reproducibly across reloads.
 */

import type { DataGridColumn, DataGridRow } from "./types";

export const MOCK_COLUMNS: DataGridColumn[] = [
  { name: "id", dbType: "int4", width: 80 },
  { name: "first_name", dbType: "text", width: 140 },
  { name: "last_name", dbType: "text", width: 140 },
  { name: "email", dbType: "text", width: 240 },
  { name: "is_active", dbType: "bool", width: 100 },
  { name: "balance", dbType: "numeric", width: 120 },
  { name: "signed_up_at", dbType: "timestamptz", width: 200 },
  { name: "tags", dbType: "_text", width: 180 },
  { name: "meta", dbType: "jsonb", width: 260 },
  { name: "bio", dbType: "text", width: 220 },
  { name: "avatar", dbType: "bytea", width: 140 },
  { name: "deleted_at", dbType: "timestamptz", width: 200 },
];

const BIO_LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
  "commodo consequat. Duis aute irure dolor in reprehenderit in voluptate " +
  "velit esse cillum dolore eu fugiat nulla pariatur.";

const FIRSTS = [
  "Alex", "Brenda", "Cyrus", "Dasha", "Elif", "Felix", "Greta", "Hiro",
  "Inez", "Janek", "Kai", "Lin", "Mara", "Noor", "Otto", "Pia", "Quinn",
  "Rune", "Saskia", "Theo", "Una", "Vik", "Wren", "Xie", "Yael", "Zane",
];
const LASTS = [
  "Adler", "Berg", "Costa", "Dahl", "Eberhardt", "Fischer", "Goss",
  "Hansen", "Iglesias", "Jonker", "Kovač", "Lévy", "Müller", "Novák",
  "Olsson", "Petrov", "Quaranta", "Ramirez", "Sato", "Tóth", "Ueda",
  "Van Dijk", "Weiss", "Xu", "Yamamoto", "Zhao",
];

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeMockRow(i: number): DataGridRow {
  const rng = mulberry32(i + 1);
  const first = FIRSTS[Math.floor(rng() * FIRSTS.length)] ?? "Anon";
  const last = LASTS[Math.floor(rng() * LASTS.length)] ?? "User";
  const email = `${first.toLowerCase()}.${last.toLowerCase().replace(/\W/g, "")}${i}@example.com`;
  const active = rng() > 0.2;
  const balance = Math.round(rng() * 1_000_000) / 100;
  const signedUp = new Date(2020, 0, 1).getTime() + Math.floor(rng() * 6 * 365 * 86400_000);
  const tagPool = ["beta", "vip", "eu", "us", "trial", "churned", "growth", "alumni"];
  const tags: string[] = [];
  for (const t of tagPool) {
    if (rng() < 0.25) tags.push(t);
  }
  const meta =
    rng() < 0.92
      ? {
          source: rng() < 0.5 ? "organic" : "referral",
          score: Math.floor(rng() * 100),
          notes: rng() < 0.3 ? "follow-up next week" : null,
          history: Array.from({ length: Math.floor(rng() * 5) }).map((_, h) => ({
            at: new Date(signedUp + h * 86400_000).toISOString(),
            event: ["signup", "login", "purchase", "refund"][Math.floor(rng() * 4)] ?? "event",
          })),
        }
      : null;
  // A varying-length text column to exercise the detail view's wrapping.
  const bio =
    rng() < 0.4
      ? BIO_LOREM.slice(0, 30 + Math.floor(rng() * 200))
      : `${first} prefers concise notes.`;
  // Bytea: a small deterministic blob with a non-trivial byte distribution
  // so the hex preview looks like data, not a stripe.
  const avatarLen = rng() < 0.08 ? 0 : 32 + Math.floor(rng() * 512);
  const avatar = new Uint8Array(avatarLen);
  for (let b = 0; b < avatarLen; b++) {
    avatar[b] = (i * 17 + b * 31) & 0xff;
  }
  const deleted = rng() < 0.05 ? new Date(signedUp + Math.floor(rng() * 30 * 86400_000)).toISOString() : null;

  return {
    id: i + 1,
    first_name: first,
    last_name: last,
    email,
    is_active: active,
    balance,
    signed_up_at: new Date(signedUp).toISOString(),
    tags,
    meta,
    bio,
    avatar,
    deleted_at: deleted,
  };
}

export function makeMockRows(count: number, offset = 0): DataGridRow[] {
  const out: DataGridRow[] = [];
  for (let i = 0; i < count; i++) {
    out.push(makeMockRow(offset + i));
  }
  return out;
}
