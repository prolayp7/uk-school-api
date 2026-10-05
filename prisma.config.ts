import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, env } from "prisma/config";

for (const envFile of [".env", ".env.migration"]) {
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
}

const connectionUrl = process.argv.includes("migrate")
  ? env("MIGRATION_DATABASE_URL")
  : env("DATABASE_URL");

export default defineConfig({
  engine: "classic",
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node src/database/seed.ts",
  },
  datasource: { url: connectionUrl },
});
