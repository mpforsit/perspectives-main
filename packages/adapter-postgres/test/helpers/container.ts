import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll } from "vitest";

import type { ConnectionProfile } from "@perspectives/engine";

const here = dirname(fileURLToPath(import.meta.url));
const SEED_SQL_PATH = resolve(here, "../fixtures/seed.sql");

const TEST_DATABASE = "perspectives_test";
const TEST_USER = "perspectives_test_user";
const TEST_PASSWORD = "perspectives_test_password";

/**
 * Spins up a one-shot Postgres container for the calling test file, seeded
 * with `seed.sql` via `/docker-entrypoint-initdb.d/`. Vitest runs each test
 * file in its own worker, so each call here is genuinely isolated.
 *
 * The returned handle holds getters rather than direct values because
 * `beforeAll` hasn't run yet at the point of call — the container starts
 * lazily, and tests read the connection profile from inside test bodies.
 */
export interface SeededPostgresHandle {
  readonly profile: ConnectionProfile;
  readonly container: StartedPostgreSqlContainer;
}

export function withSeededPostgres(): SeededPostgresHandle {
  let container: StartedPostgreSqlContainer | undefined;
  let profile: ConnectionProfile | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16")
      .withDatabase(TEST_DATABASE)
      .withUsername(TEST_USER)
      .withPassword(TEST_PASSWORD)
      .withCopyFilesToContainer([
        {
          source: SEED_SQL_PATH,
          target: "/docker-entrypoint-initdb.d/00-seed.sql",
        },
      ])
      .start();

    const now = new Date().toISOString();
    profile = {
      id: "test-connection",
      name: "test",
      dialect: "postgres",
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
      applicationName: "perspectives-tests",
      environment: "development",
      createdAt: now,
      updatedAt: now,
    };
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  return {
    get profile() {
      if (profile === undefined) {
        throw new Error(
          "withSeededPostgres: profile accessed before container started",
        );
      }
      return profile;
    },
    get container() {
      if (container === undefined) {
        throw new Error(
          "withSeededPostgres: container accessed before container started",
        );
      }
      return container;
    },
  };
}
