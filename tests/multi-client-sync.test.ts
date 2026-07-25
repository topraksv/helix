/**
 * Two isolated clients converging through one server.
 *
 * Every piece under test is the shipping one: the real migration DDL in real
 * SQLite, the real outbound validation, the real acknowledgement rule and the
 * real last-write-wins/tombstone comparison. Only the network is a stand-in,
 * and it behaves the way PostgREST does for this app — `id` conflict upsert,
 * server-assigned `updated_at`, keyset pages ordered by `(updated_at, id)`.
 *
 * A mocked sync engine would prove nothing here: the failures this package
 * exists for (a delete resurrected by a stale device, a queued row lost on
 * reconnect, a retry writing the row twice) all live in the interaction between
 * those rules and the real schema's ownership constraints.
 */

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { prepareOutboundBatch } from "../src/sync/outbound-validation";
import { remoteWinsLww, shouldApplyServerAck } from "../src/sync/merge-policy";
import { required } from "./helpers";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const ROW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSON = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function migrationStatements(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) =>
      readFileSync(join(migrationsDir, name), "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
}

const DDL = migrationStatements();

/** The engine's own local write: an upsert that refuses to cross owners. */
const UPSERT_GUARD = `INSERT INTO transactions (%COLS%) VALUES (%VALS%)
  ON CONFLICT(id) DO UPDATE SET %SETS%
  WHERE transactions.user_id = excluded.user_id`;

interface Row {
  id: string;
  user_id: string;
  updated_at: string;
  deleted_at: string | null;
  tombstone_version: number;
  note: string | null;
  [column: string]: unknown;
}

/** Minimal PostgREST stand-in: server clock, id-conflict upsert, keyset read. */
class FakeServer {
  private readonly rows = new Map<string, Row>();
  private clock = 0;
  /** Every write the server accepted, so a retry can be told from a duplicate. */
  readonly writes: string[] = [];

  private nextStamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString();
  }

  /**
   * `public.set_updated_at()` from migration 12, which is where the delete
   * generation is actually enforced: a write from an older generation is not
   * an error, it is answered with the current server row so the stale client
   * converges instead of resurrecting the record.
   */
  upsert(rows: Row[]): Row[] {
    return rows.map((row) => {
      const old = this.rows.get(row.id);
      this.writes.push(row.id);
      if (!old) {
        const inserted: Row = {
          ...row,
          tombstone_version: row.deleted_at != null && Number(row.tombstone_version) === 0 ? 1 : Number(row.tombstone_version),
          updated_at: this.nextStamp(),
        };
        this.rows.set(inserted.id, inserted);
        return { ...inserted };
      }
      const incoming = Number(row.tombstone_version);
      const current = Number(old.tombstone_version);
      if (incoming < current) return { ...old }; // keep the server row, ack it
      let version = incoming;
      if (old.deleted_at == null && row.deleted_at != null) {
        if (incoming !== current && incoming !== current + 1) throw new Error("invalid tombstone generation");
        version = current + 1;
      } else if (incoming !== current) {
        throw new Error("invalid tombstone generation");
      }
      const stored: Row = { ...row, tombstone_version: version, updated_at: this.nextStamp() };
      this.rows.set(stored.id, stored);
      return { ...stored };
    });
  }

  /** Keyset page, exactly the order and filter `pullAndMerge` asks for. */
  since(cursorTs: string, cursorId: string, limit = 1000): Row[] {
    return [...this.rows.values()]
      .filter((row) => row.updated_at > cursorTs || (row.updated_at === cursorTs && row.id > cursorId))
      .sort((a, b) => (a.updated_at === b.updated_at ? a.id.localeCompare(b.id) : a.updated_at.localeCompare(b.updated_at)))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  get(id: string): Row | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }
}

/** One device: its own SQLite file, outbox and pull cursor. */
class Client {
  readonly db = new DatabaseSync(":memory:");
  private cursorTs = "1970-01-01T00:00:00.000Z";
  private cursorId = "";
  online = true;

  constructor(readonly userId: string) {
    for (const statement of DDL) this.db.exec(statement);
  }

  /** A local write: the row plus its outbox event, exactly like `writeRows`. */
  write(row: Partial<Row> & { id: string }): void {
    const now = new Date().toISOString();
    const full: Row = {
      user_id: this.userId,
      updated_at: now,
      created_at: now,
      deleted_at: null,
      tombstone_version: 0,
      note: null,
      type: "expense",
      amount_minor: 100,
      amount_try_minor: 100,
      currency: "TRY",
      effective_date: "2026-01-01",
      entry_date: "2026-01-01",
      is_aggregate: 0,
      status: "realized",
      person_id: PERSON,
      ...row,
    } as Row;
    const columns = Object.keys(full);
    this.db
      .prepare(
        `INSERT INTO transactions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
         ON CONFLICT(id) DO UPDATE SET ${columns.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}`,
      )
      .run(...columns.map((c) => full[c] as never));
    // The real `writeRows` statement, including the idempotency key that
    // collapses a repeated write of the same revision into one event.
    this.db
      .prepare(
        `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
         VALUES (?, ?, 'upsert', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      )
      .run("transactions", full.id, JSON.stringify(full), `${full.id}:${full.updated_at}`, now);
  }

  softDelete(id: string): void {
    const current = this.row(id);
    this.write({
      ...(current as Row),
      id,
      deleted_at: new Date().toISOString(),
      tombstone_version: Number(current?.tombstone_version ?? 0) + 1,
      updated_at: new Date().toISOString(),
    });
  }

  row(id: string): Row | undefined {
    return this.db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Row | undefined;
  }

  outboxCount(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number }).n);
  }

  /** push → pull, the engine's order, with its real validation and merge rules. */
  sync(server: FakeServer): void {
    if (!this.online) return;
    this.push(server);
    this.pull(server);
  }

  private push(server: FakeServer): void {
    const events = this.db
      .prepare(`SELECT id, payload, row_id FROM outbox WHERE table_name = ? ORDER BY id ASC LIMIT 200`)
      .all("transactions") as { id: number; payload: string; row_id: string }[];
    if (events.length === 0) return;
    const { rows, pushedEvents, rejected } = prepareOutboundBatch("transactions", events, this.userId, {
      allowedColumns: new Set(Object.keys(required(events[0]) && JSON.parse(required(events[0]).payload))),
      booleanColumns: new Set(["is_aggregate"]),
    });
    const acked = server.upsert(rows as unknown as Row[]);
    for (const remote of acked) {
      const pushed = required(pushedEvents.find((event) => event.row_id === remote.id));
      const newest = this.db
        .prepare(`SELECT id FROM outbox WHERE table_name = ? AND row_id = ? ORDER BY id DESC LIMIT 1`)
        .get("transactions", remote.id) as { id: number } | undefined;
      if (shouldApplyServerAck(pushed.id, newest?.id ?? null)) this.applyRemote(remote);
    }
    expect(rejected).toHaveLength(0);
    this.db
      .prepare(`DELETE FROM outbox WHERE id IN (${events.map(() => "?").join(", ")})`)
      .run(...events.map((event) => event.id));
  }

  private pull(server: FakeServer): void {
    for (;;) {
      const page = server.since(this.cursorTs, this.cursorId);
      if (page.length === 0) return;
      for (const remote of page) {
        const local = this.row(remote.id);
        const wins = remoteWinsLww(
          local?.updated_at ?? null,
          remote.updated_at,
          Number(local?.tombstone_version ?? 0),
          Number(remote.tombstone_version),
        );
        if (wins) this.applyRemote(remote);
      }
      const last = required(page[page.length - 1]);
      this.cursorTs = last.updated_at;
      this.cursorId = last.id;
      if (page.length < 1000) return;
    }
  }

  /** The ownership-guarded upsert the engine uses for every server row.
   *  `toLocal`'s boolean coercion comes with it: Postgres answers with real
   *  booleans and SQLite stores integers. */
  private applyRemote(row: Row): void {
    const remote: Row = { ...row };
    for (const column of ["is_aggregate", "is_self", "is_active", "auto_pay", "is_column"]) {
      if (typeof remote[column] === "boolean") remote[column] = remote[column] ? 1 : 0;
    }
    const columns = Object.keys(remote);
    const sql = UPSERT_GUARD.replace("%COLS%", columns.join(", "))
      .replace("%VALS%", columns.map(() => "?").join(", "))
      .replace("%SETS%", columns.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", "));
    const result = this.db.prepare(sql).run(...columns.map((c) => remote[c] as never));
    if (result.changes !== 1) throw new Error("local ownership conflict");
  }
}

describe("two clients on one account", () => {
  let server: FakeServer;
  let a: Client;
  let b: Client;

  beforeEach(() => {
    server = new FakeServer();
    a = new Client(USER);
    b = new Client(USER);
  });

  it("carries a row created on A to B", () => {
    a.write({ id: ROW, note: "A tarafında" });
    a.sync(server);
    b.sync(server);
    expect(b.row(ROW)?.note).toBe("A tarafında");
    expect(a.outboxCount()).toBe(0);
  });

  it("carries an edit made on B back to A", () => {
    a.write({ id: ROW, note: "ilk" });
    a.sync(server);
    b.sync(server);
    b.write({ ...(b.row(ROW) as Row), note: "B düzenledi" });
    b.sync(server);
    a.sync(server);
    expect(a.row(ROW)?.note).toBe("B düzenledi");
  });

  it("applies a delete from A as a tombstone on B", () => {
    a.write({ id: ROW });
    a.sync(server);
    b.sync(server);
    a.softDelete(ROW);
    a.sync(server);
    b.sync(server);
    expect(b.row(ROW)?.deleted_at).not.toBeNull();
    expect(Number(b.row(ROW)?.tombstone_version)).toBe(1);
  });

  it("never lets a stale client resurrect a row deleted elsewhere", () => {
    a.write({ id: ROW, note: "canlı" });
    a.sync(server);
    b.sync(server);

    // B goes offline and keeps editing the row it still believes is alive.
    b.online = false;
    b.write({ ...(b.row(ROW) as Row), note: "B çevrimdışı düzenledi", updated_at: new Date(Date.now() + 60_000).toISOString() });

    a.softDelete(ROW);
    a.sync(server);

    b.online = true;
    b.sync(server);
    // B's edit carries a NEWER wall clock, but it never observed generation 1.
    expect(b.row(ROW)?.deleted_at).not.toBeNull();
    expect(server.get(ROW)?.deleted_at).not.toBeNull();
    a.sync(server);
    expect(a.row(ROW)?.deleted_at).not.toBeNull();
  });

  it("sends an offline creation once the device reconnects", () => {
    a.online = false;
    a.write({ id: ROW_B, note: "çevrimdışı" });
    a.sync(server);
    expect(server.get(ROW_B)).toBeUndefined();
    expect(a.outboxCount()).toBe(1);

    a.online = true;
    a.sync(server);
    b.sync(server);
    expect(b.row(ROW_B)?.note).toBe("çevrimdışı");
    expect(a.outboxCount()).toBe(0);
  });

  it("does not duplicate a row when the same mutation is pushed twice", () => {
    a.write({ id: ROW, note: "tek" });
    a.sync(server);
    a.write({ ...(a.row(ROW) as Row), note: "tek" });
    a.sync(server);
    b.sync(server);
    const count = b.db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE id = ?`).get(ROW) as { n: number };
    expect(Number(count.n)).toBe(1);
    expect(server.writes.filter((id) => id === ROW)).toHaveLength(2); // two pushes…
    expect(Number(count.n)).toBe(1); // …one row.
  });

  it("converges deterministically when both devices edit the same row", () => {
    a.write({ id: ROW, note: "başlangıç" });
    a.sync(server);
    b.sync(server);

    a.write({ ...(a.row(ROW) as Row), note: "A sürümü" });
    b.write({ ...(b.row(ROW) as Row), note: "B sürümü" });
    a.sync(server);
    b.sync(server); // B pushes second, so the server normalises it last.
    a.sync(server);

    // Both devices agree, and they agree with the server. The policy is
    // last-write-wins on the SERVER clock, so neither device keeps a private
    // value the other cannot see — divergence, not the losing edit, is what
    // silently corrupts a ledger.
    expect(a.row(ROW)?.note).toBe("B sürümü");
    expect(b.row(ROW)?.note).toBe("B sürümü");
    expect(server.get(ROW)?.note).toBe("B sürümü");
  });

  it("refuses a server row that belongs to another account", () => {
    a.write({ id: ROW });
    a.sync(server);
    const foreign = { ...(server.get(ROW) as Row), user_id: OTHER_USER };
    // The ownership guard is the local schema's, not a policy the caller can
    // forget to apply.
    expect(() => (a as unknown as { applyRemote: (row: Row) => void }).applyRemote(foreign)).toThrow(/ownership/);
    expect(a.row(ROW)?.user_id).toBe(USER);
  });

  it("keeps a queued row when the push never reaches the server", () => {
    a.online = false;
    a.write({ id: ROW, note: "kuyrukta" });
    a.sync(server);
    // The outbox is the only copy: losing it here is the silent data loss the
    // sign-out guard exists to prevent.
    expect(a.outboxCount()).toBe(1);
    expect(a.row(ROW)?.note).toBe("kuyrukta");
  });
});
