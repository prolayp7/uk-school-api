import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

export type SchoolAccess = {
  roleCodes: string[];
  permissionCodes: string[];
};

export async function getSchoolAccess(
  prisma: PrismaService,
  schoolId: string,
  userId: string,
): Promise<SchoolAccess> {
  const membership = await prisma.schoolMembership.findFirst({
    where: { schoolId, userId, status: "active" },
    select: {
      membershipRoles: {
        select: {
          role: {
            select: {
              code: true,
              rolePermissions: {
                where: { schoolId },
                select: { permissionCode: true },
              },
            },
          },
        },
      },
    },
  });

  const memberships = membership?.membershipRoles ?? [];
  return {
    roleCodes: memberships.map(({ role }) => role.code),
    permissionCodes: Array.from(
      new Set(
        memberships.flatMap(({ role }) =>
          role.rolePermissions.map(({ permissionCode }) => permissionCode),
        ),
      ),
    ),
  };
}

export async function hasAnySchoolPermission(
  prisma: PrismaService,
  schoolId: string,
  userId: string,
  permissionCodes: readonly string[],
): Promise<boolean> {
  const access = await getSchoolAccess(prisma, schoolId, userId);
  return (
    access.roleCodes.includes("SUPER_ADMIN") ||
    access.permissionCodes.some((permissionCode) =>
      permissionCodes.includes(permissionCode),
    )
  );
}

export async function requireAnySchoolPermission(
  prisma: PrismaService,
  schoolId: string,
  userId: string,
  permissionCodes: readonly string[],
  message = "This operation is not permitted for your school role.",
): Promise<void> {
  if (!(await hasAnySchoolPermission(prisma, schoolId, userId, permissionCodes))) {
    throw new ForbiddenException(message);
  }
}
