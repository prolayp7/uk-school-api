import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { AcademicModule } from "./academic/academic.module";
import { AdmissionsFinanceModule } from "./admissions-finance/admissions-finance.module";
import { CensusModule } from "./census/census.module";
import { BehaviourModule } from "./behaviour/behaviour.module";
import { MedicalModule } from "./medical/medical.module";
import { ErpModule } from "./erp/erp.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SupportModule } from "./support/support.module";
import { ParentsModule } from "./parents/parents.module";
import { CommunicationsModule } from "./communications/communications.module";
import { WebsiteModule } from "./website/website.module";

function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const databaseUrl = config.DATABASE_URL;
  const port = config.PORT === undefined ? 3000 : Number(config.PORT);
  const nodeEnv = config.NODE_ENV ?? "development";
  const smtpPort = config.SMTP_PORT === undefined ? undefined : Number(config.SMTP_PORT);
  const smtpUser = config.SMTP_USER || config.SMTP_USERNAME;
  const smtpValues = [
    config.SMTP_HOST,
    smtpPort,
    config.SMTP_FROM,
    config.PASSWORD_RESET_URL,
  ];
  const anySmtpSetting = [
    config.SMTP_HOST,
    config.SMTP_PORT,
    config.SMTP_FROM,
    config.PASSWORD_RESET_URL,
    smtpUser,
    config.SMTP_PASSWORD,
  ].some((value) => value !== undefined && value !== "");
  const smtpEncryption = config.SMTP_ENCRYPTION;
  const websiteRevalidateUrl = config.WEBSITE_REVALIDATE_URL;
  const websiteRevalidateSecret = config.WEBSITE_REVALIDATE_SECRET;

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
  if (
    (anySmtpSetting && smtpValues.some((value) => value === undefined || value === "")) ||
    (smtpUser && !config.SMTP_PASSWORD) ||
    (!smtpUser && config.SMTP_PASSWORD) ||
    (smtpPort !== undefined && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) ||
    (config.SMTP_SECURE !== undefined &&
      !["true", "false"].includes(String(config.SMTP_SECURE))) ||
    (smtpEncryption !== undefined &&
      !["tls", "starttls", "ssl", "smtps", "implicit", "none"].includes(
        String(smtpEncryption).toLowerCase(),
      ))
  ) {
    throw new Error(
      "SMTP_HOST, SMTP_PORT, SMTP_FROM and PASSWORD_RESET_URL must be configured together; SMTP_USER and SMTP_PASSWORD must also be paired.",
    );
  }
  if (nodeEnv === "production" && !anySmtpSetting) {
    throw new Error("SMTP password-reset delivery must be configured in production.");
  }
  if (typeof config.PASSWORD_RESET_URL === "string") {
    let resetUrl: URL;
    try {
      resetUrl = new URL(config.PASSWORD_RESET_URL);
    } catch {
      throw new Error("PASSWORD_RESET_URL must be a valid HTTP(S) URL.");
    }
    if (
      !["http:", "https:"].includes(resetUrl.protocol) ||
      (nodeEnv === "production" && resetUrl.protocol !== "https:")
    ) {
      throw new Error("PASSWORD_RESET_URL must use HTTPS in production.");
    }
  }
  if ((websiteRevalidateUrl && !websiteRevalidateSecret) || (!websiteRevalidateUrl && websiteRevalidateSecret)) {
    throw new Error("WEBSITE_REVALIDATE_URL and WEBSITE_REVALIDATE_SECRET must be configured together.");
  }
  if (nodeEnv === "production" && !websiteRevalidateUrl) {
    throw new Error("Website cache revalidation must be configured in production.");
  }
  if (typeof websiteRevalidateUrl === "string") {
    let revalidateUrl: URL;
    try {
      revalidateUrl = new URL(websiteRevalidateUrl);
    } catch {
      throw new Error("WEBSITE_REVALIDATE_URL must be a valid HTTP(S) URL.");
    }
    if (
      !["http:", "https:"].includes(revalidateUrl.protocol) ||
      (nodeEnv === "production" && revalidateUrl.protocol !== "https:")
    ) {
      throw new Error("WEBSITE_REVALIDATE_URL must use HTTPS in production.");
    }
  }

  return {
    ...config,
    DATABASE_URL: databaseUrl,
    PORT: port,
    ...(smtpPort === undefined ? {} : { SMTP_PORT: smtpPort }),
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
    CensusModule,
    BehaviourModule,
    SupportModule,
    MedicalModule,
    ParentsModule,
    CommunicationsModule,
    WebsiteModule,
    ErpModule,
    HealthModule,
  ],
})
export class AppModule {}
