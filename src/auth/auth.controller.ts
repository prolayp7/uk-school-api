import {
  Body,
  Controller,
  Delete,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { IsEmail, IsString, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";

class CreateSessionDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private extractToken(request: Request): string | undefined {
    const header = request.header("authorization");
    if (header && /^Bearer\s+/i.test(header)) {
      return header.replace(/^Bearer\s+/i, "").trim() || undefined;
    }

    if (request.header("x-session-token")) {
      return request.header("x-session-token");
    }

    return request.cookies?.session_token;
  }

  @Post("sessions")
  async createSession(
    @Body() body: CreateSessionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.createSession({
      email: body.email,
      password: body.password,
    });

    response.cookie("session_token", session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    return {
      token: session.token,
      user: session.user,
      schools: session.schools,
    };
  }

  @Delete("sessions/current")
  @UseGuards(AuthGuard)
  revokeCurrentSession(
    @Req() request: Request,
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Authentication required.");
    }

    const revoked = this.authService.revokeSession(token);
    response.clearCookie("session_token", { path: "/" });

    return {
      revoked,
      userId: user.id,
      status: revoked ? "revoked" : "not_found",
    };
  }

  @Post("password/forgot")
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const token = await this.authService.requestPasswordReset(body.email);
    return {
      token,
      message: "If the account exists, a password reset token has been issued.",
    };
  }

  @Post("password/reset")
  async resetPassword(@Body() body: ResetPasswordDto) {
    const reset = await this.authService.resetPassword({
      token: body.token,
      password: body.password,
    });

    return {
      success: reset,
      status: reset ? "updated" : "invalid_or_expired",
    };
  }
}
