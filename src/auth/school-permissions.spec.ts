import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { hasAnySchoolPermission, requireAnySchoolPermission } from "./school-permissions";

describe("school permissions", () => {
  it("grants access only for permissions on the active membership in the requested school", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      membershipRoles: [{
        role: {
          code: "TEACHER",
          rolePermissions: [{ permissionCode: "attendance.read" }],
        },
      }],
    });
    const prisma = { schoolMembership: { findFirst } } as unknown as PrismaService;

    await expect(
      hasAnySchoolPermission(prisma, "school-1", "teacher-1", ["attendance.read"]),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { schoolId: "school-1", userId: "teacher-1", status: "active" },
      select: {
        membershipRoles: {
          select: {
            role: {
              select: {
                code: true,
                rolePermissions: {
                  where: { schoolId: "school-1" },
                  select: { permissionCode: true },
                },
              },
            },
          },
        },
      },
    });
  });

  it("denies an access area after its permission is removed", async () => {
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [{
            role: { code: "TEACHER", rolePermissions: [] },
          }],
        }),
      },
    } as unknown as PrismaService;

    await expect(
      requireAnySchoolPermission(prisma, "school-1", "teacher-1", ["attendance.read"]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("preserves the built-in Superadmin permission bypass", async () => {
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn().mockResolvedValue({
          membershipRoles: [{
            role: { code: "SUPER_ADMIN", rolePermissions: [] },
          }],
        }),
      },
    } as unknown as PrismaService;

    await expect(
      requireAnySchoolPermission(prisma, "school-1", "admin-1", ["attendance.read"]),
    ).resolves.toBeUndefined();
  });

  it("denies access when there is no active membership in the requested school", async () => {
    const prisma = {
      schoolMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    await expect(
      requireAnySchoolPermission(prisma, "school-2", "admin-1", ["attendance.read"]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
