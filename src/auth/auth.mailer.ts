import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class AuthMailer {
  async sendPasswordReset(email: string, token: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    const from = process.env.SMTP_FROM;
    const resetUrl = process.env.PASSWORD_RESET_URL;
    if (!host || !port || !from || !resetUrl) {
      throw new ServiceUnavailableException(
        "Password reset email is not configured. Contact your school administrator.",
      );
    }

    const user = process.env.SMTP_USER || process.env.SMTP_USERNAME;
    const password = process.env.SMTP_PASSWORD;
    const encryption = process.env.SMTP_ENCRYPTION?.toLowerCase();
    const url = new URL(resetUrl);
    url.searchParams.set("token", token);
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure:
        process.env.SMTP_SECURE === undefined
          ? port === 465 || ["ssl", "smtps", "implicit"].includes(encryption ?? "")
          : process.env.SMTP_SECURE === "true",
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
    const link = url.toString();
    await transporter.sendMail({
      from,
      to: email,
      subject: "Reset your school portal password",
      text: `A password reset was requested for your school portal account. Reset it within 15 minutes: ${link}\n\nIf you did not request this, ignore this email.`,
      html: `<p>A password reset was requested for your school portal account.</p><p><a href="${link}">Reset your password</a> (link expires in 15 minutes).</p><p>If you did not request this, ignore this email.</p>`,
    });
  }
}
