import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard, SchoolAccessGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ParentsService } from "./parents.service";
import { UpdateParentContactDto, UpdateParentPortalPasswordDto } from "./parents.dto";

type AuthenticatedUser = {
  id: string;
  roleCodes: string[];
  permissions: string[];
  schoolIds: string[];
};

const MAX_PARENT_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PARENT_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function resolveSchoolId(user: AuthenticatedUser, requestedSchoolId?: string): string {
  if (requestedSchoolId) return requestedSchoolId;
  if (user.schoolIds.length === 1) return user.schoolIds[0];
  if (user.schoolIds.length > 1) throw new BadRequestException("Select a school with the x-school-id header.");
  throw new BadRequestException("An active school membership is required.");
}

@Controller("erp/parents")
@UseGuards(AuthGuard, SchoolAccessGuard)
export class ParentsController {
  constructor(private readonly parentsService: ParentsService) {}

  @Patch(":parentId")
  @UseInterceptors(FileInterceptor("photo", {
    limits: { fileSize: MAX_PARENT_PHOTO_BYTES, files: 1, fields: 8 },
    fileFilter: (_request, file, callback) => {
      if (!ALLOWED_PARENT_PHOTO_TYPES.has(file.mimetype)) {
        callback(new BadRequestException("Upload a JPEG, PNG or WebP image."), false);
        return;
      }
      callback(null, true);
    },
  }))
  updateContact(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("parentId") parentId: string,
    @Body() input: UpdateParentContactDto,
    @UploadedFile() photo?: { buffer: Buffer; mimetype: string },
  ) {
    return this.parentsService.updateContact(
      resolveSchoolId(user, schoolId), user, parentId, input, photo,
    );
  }

  @Post(":parentId/portal-password")
  updatePortalPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("parentId") parentId: string,
    @Body() body: UpdateParentPortalPasswordDto,
  ) {
    return this.parentsService.updatePortalPassword(
      resolveSchoolId(user, schoolId), user, parentId, body.password,
    );
  }

  @Get(":parentId/portal-login")
  getPortalLogin(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("parentId") parentId: string,
  ) {
    return this.parentsService.getPortalLogin(
      resolveSchoolId(user, schoolId), user, parentId,
    );
  }

  @Get(":parentId/photo")
  @Header("Cache-Control", "private, no-store")
  async getPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("x-school-id") schoolId: string | undefined,
    @Param("parentId") parentId: string,
  ) {
    const photo = await this.parentsService.getPhoto(
      resolveSchoolId(user, schoolId), user, parentId,
    );
    return new StreamableFile(photo.buffer, { type: photo.contentType, disposition: "inline" });
  }
}