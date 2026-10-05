# uk-school-api

NestJS modular monolith for the UK School ERP and the public Website API.
PostgreSQL is the only V1 stateful infrastructure dependency; Redis and
paid queue/cache services are not required.

## Local setup

Requirements: Node.js 22+, pnpm 9+, and PostgreSQL 15+.

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the restricted
	runtime role. Copy `.env.migration.example` to `.env.migration` and set
	`MIGRATION_DATABASE_URL` to a local migration-owner connection.
3. Generate the Prisma client with `pnpm prisma:generate`. Apply schema changes
	with `pnpm db:migrate:dev` locally or `npx prisma migrate deploy` for a
	versioned deployment. Prisma CLI loads `.env.migration` for migration
	commands; Nest loads only `.env` and continues to use `DATABASE_URL`.
4. Create the runtime role with PostgreSQL's `\password` command and grant it
	only application-table DML. Revoke access to `public._prisma_migrations` and
	set default privileges for future application tables under the migration
	owner.
5. Start the API with `pnpm start:dev`. Keep `.env.migration` out of source
	control and never use its owner connection to run the API.

Stripe payment checkout and webhook processing are disabled until both
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in `.env`. Configure
the Stripe webhook for `/api/v1/integrations/payments/stripe/webhook`; the
API verifies the signature against the raw request body.

The server listens on `PORT` (default `3000`). OpenAPI is available at
`/api/v1/docs`; liveness and readiness checks are at
`/api/v1/health/live` and `/api/v1/health/ready`.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:validate
```

Readiness requires a working PostgreSQL connection. Do not use production
credentials or production data for local development. Migrations are
versioned under `prisma/migrations/`; never reset a production database.