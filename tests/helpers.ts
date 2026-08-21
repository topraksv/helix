import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { TxLike } from "../src/domain/types";

let txCounter = 0;

/** Build a TxLike with sensible defaults; amounts in minor units (kuruş). */
export function tx(overrides: Partial<TxLike> & Pick<TxLike, "type" | "amountTryMinor" | "effectiveDate">): TxLike {
  return {
    id: `tx-${++txCounter}`,
    purchaseDate: null,
    status: "realized",
    categoryId: null,
    categoryKind: null,
    paymentSourceId: null,
    personIsSelf: true,
    installmentPlanId: null,
    cardStatementId: null,
    subscriptionId: null,
    isAggregate: false,
    ...overrides,
  };
}

/** "18.822,92" → 1882292 (test readability for Excel golden values). */
export function tl(s: string): number {
  const [intPart, frac = "00"] = s.replace(/\./g, "").split(",");
  if (intPart == null) throw new Error(`Invalid test amount: ${s}`);
  const sign = intPart.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(intPart)) * 100 + Number((frac + "00").slice(0, 2)));
}

export function required<T>(value: T | undefined | null, context = "required test value"): T {
  if (value == null) throw new Error(`Missing ${context}`);
  return value;
}

/**
 * The `src/db/client` surface, backed by a real `node:sqlite` database.
 *
 * Six repository suites carried a byte-identical copy of this adapter, so a
 * change to how the tests see the driver had to be made six times or not at
 * all. The suites that intercept particular SQL, count acquisitions or
 * simulate a migration failure keep their own — those differences are the
 * point of those suites.
 *
 * `db` is a getter, not a database: the file is created in `beforeEach`, long
 * after the hoisted `vi.mock` factory that calls this has run. `onAcquire` is
 * for the two suites that assert how OFTEN the driver is reached, which is how
 * they prove a repository call does not re-open the database per row.
 */
export function sqliteClientMock(db: () => DatabaseSync, onAcquire?: () => void) {
  return {
    getSqliteAsync: async () => {
      onAcquire?.();
      return {
        getFirstAsync: async (sql: string, args: unknown[] = []) =>
          db().prepare(sql).get(...(args as never[])) ?? null,
        getAllAsync: async (sql: string, args: unknown[] = []) => db().prepare(sql).all(...(args as never[])),
        runAsync: async (sql: string, args: unknown[] = []) => ({
          changes: Number(db().prepare(sql).run(...(args as never[])).changes),
        }),
      };
    },
    withTransaction: async (task: () => Promise<void>) => {
      db().exec("BEGIN");
      try {
        await task();
        db().exec("COMMIT");
      } catch (error) {
        db().exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/**
 * Every migration statement, in order, ready to `exec` into a fresh database.
 *
 * Eleven suites built this list themselves from the same directory with the
 * same breakpoint split. Read once at module load, because the migrations do
 * not change between tests and re-reading them per suite is pure I/O.
 */
export const migrationStatements: string[] = (() => {
  const dir = join(process.cwd(), "src/db/migrations");
  return readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("--> statement-breakpoint"))
    .map((statement) => statement.trim())
    .filter(Boolean);
})();
