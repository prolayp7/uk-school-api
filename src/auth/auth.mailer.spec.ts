import nodemailer from "nodemailer";
import { AuthMailer } from "./auth.mailer";

describe("AuthMailer", () => {
  const envKeys = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_FROM",
    "SMTP_USER",
    "SMTP_USERNAME",
    "SMTP_ENCRYPTION",
    "SMTP_PASSWORD",
    "PASSWORD_RESET_URL",
  ] as const;
  const originalEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("fails explicitly when SMTP is not configured", async () => {
    for (const key of envKeys) delete process.env[key];
    await expect(new AuthMailer().sendPasswordReset("staff@example.test", "secret"))
      .rejects.toThrow("Password reset email is not configured");
  });

  it("sends an opaque reset link using configured SMTP credentials", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_FROM = "School Portal <portal@example.test>";
    process.env.SMTP_USER = "mailer";
    process.env.SMTP_PASSWORD = "test-only-password";
    process.env.PASSWORD_RESET_URL = "https://erp.example.test/reset-password";
    const sendMail = jest.fn().mockResolvedValue({});
    const createTransport = jest.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);

    await new AuthMailer().sendPasswordReset("staff@example.test", "opaque-token");

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      auth: { user: "mailer", pass: "test-only-password" },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "staff@example.test",
      from: "School Portal <portal@example.test>",
      text: expect.stringContaining("https://erp.example.test/reset-password?token=opaque-token"),
    }));
  });

  it("supports SMTP_USERNAME and STARTTLS-style encryption settings", async () => {
    for (const key of envKeys) delete process.env[key];
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_ENCRYPTION = "TLS";
    process.env.SMTP_FROM = "School Portal <portal@example.test>";
    process.env.SMTP_USERNAME = "mailer";
    process.env.SMTP_PASSWORD = "test-only-password";
    process.env.PASSWORD_RESET_URL = "https://erp.example.test/reset-password";
    const sendMail = jest.fn().mockResolvedValue({});
    const createTransport = jest.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);

    await new AuthMailer().sendPasswordReset("staff@example.test", "opaque-token");

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      auth: { user: "mailer", pass: "test-only-password" },
    });
    expect(sendMail).toHaveBeenCalled();
  });

  it("uses implicit TLS for SSL encryption when secure mode is not explicitly set", async () => {
    for (const key of envKeys) delete process.env[key];
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_ENCRYPTION = "SSL";
    process.env.SMTP_FROM = "School Portal <portal@example.test>";
    process.env.PASSWORD_RESET_URL = "https://erp.example.test/reset-password";
    const sendMail = jest.fn().mockResolvedValue({});
    const createTransport = jest.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);

    await new AuthMailer().sendPasswordReset("staff@example.test", "opaque-token");

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 465,
      secure: true,
    });
  });
});
