import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { AcademicModule } from "./academic/academic.module";
import { AdmissionsFinanceModule } from "./admissions-finance/admissions-finance.module";
import { BehaviourModule } from "./behaviour/behaviour.module";
import { MedicalModule } from "./medical/medical.module";
import { ErpModule } from "./erp/erp.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SupportModule } from "./support/support.module";

function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const databaseUrl = config.DATABASE_URL;
  const port = config.PORT === undefined ? 3000 : Number(config.PORT);
  const nodeEnv = config.NODE_ENV ?? "development";

  if (typeof databaseUrl !== "string") {
    throw new Error("DATABASE_URL must be configured.");
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
    !parsedDatabaseUrl.hostname ||
    parsedDatabaseUrl.pathname.length < 2
  ) {
    throw new Error(
      "DATABASE_URL must include a PostgreSQL scheme, host, and database name.",
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  if (
    !["development", "test", "staging", "production"].includes(String(nodeEnv))
  ) {
    throw new Error(
      "NODE_ENV must be development, test, staging, or production.",
    );
  }

  return {
    ...config,
    DATABASE_URL: databaseUrl,
    PORT: port,
    NODE_ENV: nodeEnv,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    AuthModule,
    AttendanceModule,
    AcademicModule,
    AdmissionsFinanceModule,
    BehaviourModule,
    SupportModule,
    MedicalModule,
    ErpModule,
    HealthModule,
  ],
})
export class AppModule {}
