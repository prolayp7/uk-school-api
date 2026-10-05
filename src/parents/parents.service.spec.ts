import { ForbiddenException } from "@nestjs/common";
import sharp from "sharp";
import type { AuthService } from "../auth/auth.service";
import { FileStorageService } from "../common/file-storage.service";
import type { PrismaService } from "../prisma/prisma.service";
import { ParentsService } from "./parents.service";

describe("ParentsService", () => {
  const profile = {
    id: "profile-1",
    schoolId: "school-1",
    personId: "person-1",
    externalId: "sarah-turner",
    title: "Mrs",
    email: "old@example.test",
    phone: "07700 900000",
    landline: "",
    residentialAddress: "Old address",
    photoStoragePath: null,
    person: {
      id: "person-1",
      userId: null,
      legalFirstName: "Old",
      lastName: "Contact",
    },
  };

  function setup() {
    const tx = {
      parentCarerProfile: {
        update: jest.fn().mockResolvedValue({
          ...profile,
          title: "Dr",
          email: "sarah@example.test",
          phone: "07700 900124",
          landline: "0191 498 0221",
          residentialAddress: "14 High Street",
        }),
      },
      person: { update: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      parentCarerProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
      user: { findUnique: jest.fn().mockResolvedValue({ emailNormalized: "parent001@example.test", status: "active" }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const storage = {
      saveFile: jest.fn(),
      deleteFile: jest.fn(),
      readFile: jest.fn(),
    } as unknown as FileStorageService;
    const authService = { updatePasswordForEmail: jest.fn().mockResolvedValue(undefined) } as unknown as AuthService;
    return { service: new ParentsService(prisma, storage, authService), prisma, tx, storage, authService };
  }

  it("updates the school-scoped profile resolved by its UI slug and audits the change", async () => {
    const { service, prisma, tx } = setup();
    const result = await service.updateContact(
      "school-1",
      { id: "staff-1", roleCodes: ["SUPER_ADMIN"], permissions: ["school.members.manage"] },
      "sarah-turner",
      {
        name: "Sarah Turner",
        title: "Dr",
        email: "sarah@example.test",
        mobile: "07700 900124",
        landline: "0191 498 0221",
        address: "14 High Street",
        postcode: "NE1 1AA",
      },
    );

    expect(prisma.parentCarerProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: "school-1", OR: [{ externalId: "sarah-turner" }] },
    }));
    expect(tx.parentCarerProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId_personId: { schoolId: "school-1", personId: "person-1" } },
      data: expect.objectContaining({ email: "sarah@example.test", phone: "07700 900124" }),
    }));
    expect(tx.person.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legalFirstName: "Sarah", lastName: "Turner", postcode: "NE1 1AA" }),
    }));
    expect(tx.auditEvent.create).toHaveBeenCalled();
    expect(result).toMatchObject({ id: "sarah-turner", name: "Sarah Turner", email: "sarah@example.test" });
  });

  it("rejects editors without parent management permission before writing", async () => {
    const { service, tx } = setup();

    await expect(service.updateContact(
      "school-1",
      { id: "staff-2", roleCodes: ["TEACHER"], permissions: [] },
      "sarah-turner",
      { name: "Sarah Turner", mobile: "07700 900124" },
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.parentCarerProfile.update).not.toHaveBeenCalled();
    expect(tx.person.update).not.toHaveBeenCalled();
  });

  it("converts accepted PNG uploads to WebP before external storage", async () => {
    const { service, storage } = setup();
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "white" },
    }).png().toBuffer();

    await service.updateContact(
      "school-1",
      { id: "staff-1", roleCodes: ["SUPER_ADMIN"], permissions: ["school.members.manage"] },
      "sarah-turner",
      { name: "Sarah Turner", mobile: "07700 900124" },
      { buffer: png, mimetype: "image/png" },
    );

    const [category, filename, storedImage] = (storage.saveFile as jest.Mock).mock.calls[0];
    expect(category).toBe("parents");
    expect(filename).toBe("contact-photo.webp");
    await expect(sharp(storedImage).metadata()).resolves.toMatchObject({ format: "webp" });
  });

  it("rejects unsupported and oversized profile images before storage", async () => {
    const { service, storage } = setup();
    const user = { id: "staff-1", roleCodes: ["SUPER_ADMIN"], permissions: ["school.members.manage"] };
    const input = { name: "Sarah Turner", mobile: "07700 900124" };

    await expect(service.updateContact("school-1", user, "sarah-turner", input, {
      buffer: Buffer.from("not an image"),
      mimetype: "image/gif",
    })).rejects.toThrow("Upload a JPEG, PNG or WebP image.");
    await expect(service.updateContact("school-1", user, "sarah-turner", input, {
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
      mimetype: "image/jpeg",
    })).rejects.toThrow("Choose an image no larger than 2 MB.");
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it("updates the linked portal account password and audits the change", async () => {
    const { service, prisma, authService } = setup();
    (prisma.parentCarerProfile.findFirst as jest.Mock).mockResolvedValue({
      ...profile,
      person: { ...profile.person, userId: "portal-user-1" },
    });

    await expect(service.updatePortalPassword(
      "school-1",
      { id: "admin-1", roleCodes: ["SUPER_ADMIN"], permissions: [] },
      "sarah-turner",
      "SecurePass123!",
    )).resolves.toMatchObject({ success: true });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "portal-user-1" },
    }));
    expect(authService.updatePasswordForEmail).toHaveBeenCalledWith("parent001@example.test", "SecurePass123!");
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });

  it("rejects portal password updates from non-super-admin users", async () => {
    const { service, authService } = setup();

    await expect(service.updatePortalPassword(
      "school-1",
      { id: "staff-1", roleCodes: ["ADMIN"], permissions: ["school.members.manage"] },
      "sarah-turner",
      "SecurePass123!",
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(authService.updatePasswordForEmail).not.toHaveBeenCalled();
  });

  it("returns the linked portal email only to super administrators", async () => {
    const { service, prisma } = setup();
    (prisma.parentCarerProfile.findFirst as jest.Mock).mockResolvedValue({
      ...profile,
      person: { ...profile.person, userId: "portal-user-1" },
    });

    await expect(service.getPortalLogin(
      "school-1",
      { id: "admin-1", roleCodes: ["SUPER_ADMIN"], permissions: [] },
      "sarah-turner",
    )).resolves.toEqual({ email: "parent001@example.test" });
  });
});