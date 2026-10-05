import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import sharp from "sharp";
import { AuthService } from "../auth/auth.service";
import { FileStorageService } from "../common/file-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateParentContactDto } from "./parents.dto";

type ParentEditor = {
  id: string;
  roleCodes: string[];
  permissions: string[];
};

type UploadedPhoto = {
  buffer: Buffer;
  mimetype: string;
};

const MANAGEMENT_ROLES = new Set(["SUPER_ADMIN", "HEADTEACHER", "SLT", "ADMIN"]);
const MAX_PARENT_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_FORMATS = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

@Injectable()
export class ParentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly authService: AuthService,
  ) {}

  private async findParent(schoolId: string, parentId: string) {
    const identifiers: Array<{ id?: string; externalId?: string }> = [
      { externalId: parentId },
    ];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parentId)) {
      identifiers.push({ id: parentId });
    }

    const profile = await this.prisma.parentCarerProfile.findFirst({
      where: { schoolId, OR: identifiers },
      include: {
        person: {
          select: {
            id: true,
            userId: true,
            legalFirstName: true,
            lastName: true,
          },
        },
      },
    });
    if (!profile) throw new NotFoundException("Parent or carer not found.");
    return profile;
  }

  private assertCanEdit(
    user: ParentEditor,
    profile: { person: { userId: string | null } },
  ): void {
    const staffCanEdit =
      user.roleCodes.some((role) => MANAGEMENT_ROLES.has(role)) &&
      user.permissions.includes("school.members.manage");
    const parentCanEdit = user.roleCodes.includes("PARENT") && profile.person.userId === user.id;
    if (!staffCanEdit && !parentCanEdit) {
      throw new ForbiddenException("You do not have permission to edit this parent or carer.");
    }
  }

  private assertSuperAdmin(user: ParentEditor): void {
    if (!user.roleCodes.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Super administrator access is required.");
    }
  }

  async updateContact(
    schoolId: string,
    user: ParentEditor,
    parentId: string,
    input: UpdateParentContactDto,
    photo?: UploadedPhoto,
  ) {
    if (!input.name.trim() || (!input.email?.trim() && !input.mobile?.trim())) {
      throw new BadRequestException("Enter a name and at least one email address or mobile number.");
    }

    const profile = await this.findParent(schoolId, parentId);
    this.assertCanEdit(user, profile);

    let newPhotoPath: string | undefined;
    if (photo) {
      if (photo.buffer.length > MAX_PARENT_PHOTO_BYTES) {
        throw new BadRequestException("Choose an image no larger than 2 MB.");
      }
      const expectedFormat = PHOTO_FORMATS.get(photo.mimetype);
      if (!expectedFormat) {
        throw new BadRequestException("Upload a JPEG, PNG or WebP image.");
      }
      let actualFormat: string | undefined;
      let webpBuffer: Buffer;
      try {
        actualFormat = (await sharp(photo.buffer, { limitInputPixels: 40_000_000 }).metadata()).format;
        if (actualFormat !== expectedFormat) {
          throw new BadRequestException("The image content does not match its file type.");
        }
        webpBuffer = await sharp(photo.buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .webp({ quality: 82 })
          .toBuffer();
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException("Upload a valid JPEG, PNG or WebP image.");
      }
      if (webpBuffer.length > MAX_PARENT_PHOTO_BYTES) {
        throw new BadRequestException("The converted WebP image exceeds the 2 MB limit.");
      }
      newPhotoPath = await this.storage.saveFile("parents", "contact-photo.webp", webpBuffer);
    }

    const nameParts = input.name.trim().split(/\s+/).filter(Boolean);
    const lastName = nameParts.length > 1 ? nameParts.pop()! : "";
    const firstName = nameParts.join(" ") || input.name.trim();
    const address = input.address?.trim() ?? "";
    const addressLines = address.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        const updatedProfile = await transaction.parentCarerProfile.update({
          where: { schoolId_personId: { schoolId, personId: profile.personId } },
          data: {
            title: input.title?.trim() || null,
            email: input.email?.trim().toLowerCase() ?? profile.email,
            phone: input.mobile?.trim() ?? profile.phone,
            landline: input.landline?.trim() || null,
            residentialAddress: address || null,
            ...(newPhotoPath ? { photoStoragePath: newPhotoPath } : {}),
          },
        });
        await transaction.person.update({
          where: { id: profile.personId },
          data: {
            legalFirstName: firstName.slice(0, 100),
            lastName: lastName.slice(0, 100),
            addressLine1: addressLines[0]?.slice(0, 160) ?? null,
            addressLine2: addressLines[1]?.slice(0, 160) ?? null,
            town: addressLines.slice(2).join(", ").slice(0, 100) || null,
            postcode: input.postcode?.trim().toUpperCase() || null,
            phoneNumber: input.mobile?.trim() || null,
          },
        });
        await transaction.auditEvent.create({
          data: {
            schoolId,
            actorUserId: user.id,
            action: "parent_contact.updated",
            entityType: "parent_carer_profile",
            entityId: profile.personId,
            metadata: { photoUpdated: Boolean(newPhotoPath) },
          },
        });
        return updatedProfile;
      });

      if (newPhotoPath && profile.photoStoragePath) {
        await this.storage.deleteFile(profile.photoStoragePath).catch(() => undefined);
      }

      return {
        message: "Parent contact updated successfully.",
        id: updated.externalId ?? updated.personId,
        title: updated.title ?? "",
        name: `${firstName} ${lastName}`.trim(),
        email: updated.email,
        mobile: updated.phone,
        landline: updated.landline ?? "",
        address: updated.residentialAddress ?? "",
        postcode: input.postcode?.trim().toUpperCase() ?? "",
        photoStoragePath: updated.photoStoragePath,
      };
    } catch (error) {
      if (newPhotoPath) await this.storage.deleteFile(newPhotoPath).catch(() => undefined);
      throw error;
    }
  }

  async updatePortalPassword(
    schoolId: string,
    user: ParentEditor,
    parentId: string,
    password: string,
  ) {
    this.assertSuperAdmin(user);

    const profile = await this.findParent(schoolId, parentId);
    const portalUserId = profile.person.userId;
    if (!portalUserId) {
      throw new NotFoundException("No linked portal account was found for this contact.");
    }

    const portalUser = await this.prisma.user.findUnique({
      where: { id: portalUserId },
      select: { emailNormalized: true, status: true },
    });
    if (!portalUser || portalUser.status !== "active") {
      throw new NotFoundException("No active portal account was found for this contact.");
    }

    await this.authService.updatePasswordForEmail(portalUser.emailNormalized, password);
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: user.id,
        action: "parent_portal.password_updated",
        entityType: "parent_carer_profile",
        entityId: profile.personId,
        metadata: { portalUserId },
      },
    });

    return { success: true, message: "Portal password updated successfully." };
  }

  async getPortalLogin(schoolId: string, user: ParentEditor, parentId: string) {
    this.assertSuperAdmin(user);
    const profile = await this.findParent(schoolId, parentId);
    if (!profile.person.userId) {
      throw new NotFoundException("No linked portal account was found for this contact.");
    }

    const portalUser = await this.prisma.user.findUnique({
      where: { id: profile.person.userId },
      select: { emailNormalized: true, status: true },
    });
    if (!portalUser || portalUser.status !== "active") {
      throw new NotFoundException("No active portal account was found for this contact.");
    }

    return { email: portalUser.emailNormalized };
  }

  async getPhoto(schoolId: string, user: ParentEditor, parentId: string) {
    const profile = await this.findParent(schoolId, parentId);
    this.assertCanEdit(user, profile);
    if (!profile.photoStoragePath) throw new NotFoundException("Parent photo not found.");

    try {
      const buffer = await this.storage.readFile(profile.photoStoragePath);
      const extension = profile.photoStoragePath.split(".").at(-1)?.toLowerCase();
      const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      return { buffer, contentType };
    } catch {
      throw new NotFoundException("Parent photo not found.");
    }
  }
}