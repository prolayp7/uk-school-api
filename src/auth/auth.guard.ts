import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService } from "./auth.service";

function getSessionToken(request: Request): string | null {
  const authHeader = request.header("authorization");
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim() || null;
  }

  const xSessionToken = request.header("x-session-token");
  if (xSessionToken) {
    return xSessionToken;
  }

  const cookieValue = request.cookies?.session_token;
  if (cookieValue) {
    return cookieValue;
  }

  return null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const token = getSessionToken(request);

    if (!token) {
      throw new UnauthorizedException("Authentication required.");
    }

    const session = this.authService.resolveSession(token);
    if (!session) {
      throw new UnauthorizedException("Session is invalid or expired.");
    }

    request.user = {
      id: session.user.id,
      emailNormalized: session.user.emailNormalized,
      schoolIds: session.schoolIds,
      permissions: session.user.permissions,
      roleCodes: session.user.roleCodes,
      schools: session.user.schools,
    };

    return true;
  }
}

@Injectable()
export class SchoolAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const schoolId =
      (request.params?.schoolId as string | undefined) ??
      (request.query?.schoolId as string | undefined) ??
      (request.header("x-school-id") as string | undefined);

    if (!schoolId) {
      return true;
    }

    const user = request.user as { schoolIds?: string[] } | undefined;
    if (!user?.schoolIds || !user.schoolIds.includes(schoolId)) {
      throw new ForbiddenException("You do not have access to this school.");
    }

    return true;
  }
}
