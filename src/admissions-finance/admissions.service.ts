import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateApplicationDto,
  CreateEnrolmentHandoffDto,
  CreateOfferDto,
  OfferResponseDto,
  RequestApplicationDocumentDto,
  UpdateApplicationStatusDto,
} from "./admissions-finance.dto";

const ADMISSIONS_ROLES = ["ADMISSIONS_OFFICER", "HEADTEACHER", "SLT"];

const STAFF_TRANSITIONS: Record<string, string[]> = {
  submitted: ["reviewing", "documents_requested", "waitlisted", "declined", "withdrawn"],
  reviewing: ["documents_requested", "waitlisted", "declined", "withdrawn"],
  documents_requested: ["reviewing", "waitlisted", "declined", "withdrawn"],
  waitlisted: ["reviewing", "declined", "withdrawn"],
  offered: ["withdrawn"],
  accepted: ["withdrawn"],
  declined: [],
  withdrawn: [],
  enrolled: [],
};

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class AdmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPublicApplication(schoolId: string, input: CreateApplicationDto) {
    const school = await this.prisma.school.findFirst({ where: { id: schoolId, status: "active" }, select: { id: true } });
    if (!school) throw new NotFoundException("School not found.");
    if (input.targetYearGroupId) {
      const yearGroup = await this.prisma.yearGroup.findFirst({ where: { schoolId, id: input.targetYearGroupId }, select: { id: true } });
      if (!yearGroup) throw new BadRequestException("Requested year group is not available at this school.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.application.create({
        data: {
          schoolId,
          targetYearGroupId: input.targetYearGroupId,
          reference: `APP-${randomUUID().slice(0, 10).toUpperCase()}`,
          applicantName: input.applicantName.trim(),
          applicantEmail: input.applicantEmail.trim().toLowerCase(),
          applicantPhone: input.applicantPhone.trim(),
          pupilFirstName: input.pupilFirstName.trim(),
          pupilLastName: input.pupilLastName.trim(),
          pupilDateOfBirth: dateOnly(input.pupilDateOfBirth),
        },
        select: { id: true, reference: true, status: true, submittedAt: true },
      });
      await transaction.applicationStatusHistory.create({
        data: { schoolId, applicationId: application.id, fromStatus: null, toStatus: "submitted" },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          action: "admissions.application.submitted",
          entityType: "application",
          entityId: application.id,
          metadata: { reference: application.reference },
        },
      });
      return application;
    });
  }

  async listApplications(schoolId: string, userId: string, status?: string) {
    await this.requireAdmissionsRole(schoolId, userId);
    const applications = await this.prisma.application.findMany({
      where: { schoolId, ...(status ? { status } : {}) },
      orderBy: { submittedAt: "desc" },
      take: 100,
      select: {
        id: true,
        reference: true,
        applicantName: true,
        applicantEmail: true,
        pupilFirstName: true,
        pupilLastName: true,
        status: true,
        submittedAt: true,
        targetYearGroup: { select: { code: true, name: true } },
        _count: { select: { documents: true, offers: true } },
      },
    });
    return { items: applications, total: applications.length };
  }

  async linkParent(schoolId: string, userId: string, applicationId: string, parentUserId: string) {
    await this.requireAdmissionsRole(schoolId, userId);
    const parent = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId: parentUserId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { id: true },
    });
    if (!parent) throw new BadRequestException("Application access can only be linked to an active parent account in this school.");
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.application.findFirst({ where: { schoolId, id: applicationId }, select: { id: true } });
      if (!application) throw new NotFoundException("Application not found.");
      const linked = await transaction.application.update({
        where: { schoolId_id: { schoolId, id: applicationId } },
        data: { applicantUserId: parentUserId },
        select: { id: true, reference: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "admissions.application.parent_linked",
          entityType: "application",
          entityId: applicationId,
          metadata: { parentUserId },
        },
      });
      return linked;
    });
  }

  async updateStatus(schoolId: string, userId: string, applicationId: string, input: UpdateApplicationStatusDto) {
    await this.requireAdmissionsRole(schoolId, userId);
    if (["offered", "accepted", "enrolled"].includes(input.status)) {
      throw new BadRequestException("Offer, acceptance, and enrolment statuses must use their dedicated verified workflows.");
    }
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.application.findFirst({ where: { schoolId, id: applicationId }, select: { id: true, status: true } });
      if (!application) throw new NotFoundException("Application not found.");
      if (!STAFF_TRANSITIONS[application.status]?.includes(input.status)) {
        throw new BadRequestException(`Application cannot transition from ${application.status} to ${input.status}.`);
      }
      const updated = await transaction.application.update({
        where: { schoolId_id: { schoolId, id: applicationId } },
        data: { status: input.status },
        select: { id: true, reference: true, status: true, updatedAt: true },
      });
      await transaction.applicationStatusHistory.create({
        data: {
          schoolId,
          applicationId,
          fromStatus: application.status,
          toStatus: input.status,
          note: input.note?.trim(),
          actorUserId: userId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "admissions.application.status_changed",
          entityType: "application",
          entityId: applicationId,
          metadata: { fromStatus: application.status, toStatus: input.status },
        },
      });
      return updated;
    });
  }

  async requestDocument(schoolId: string, userId: string, applicationId: string, input: RequestApplicationDocumentDto) {
    await this.requireAdmissionsRole(schoolId, userId);
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.application.findFirst({ where: { schoolId, id: applicationId }, select: { id: true } });
      if (!application) throw new NotFoundException("Application not found.");
      const document = await transaction.applicationDocument.create({
        data: {
          schoolId,
          applicationId,
          documentType: input.documentType.trim(),
          requestedByUserId: userId,
        },
        select: { id: true, documentType: true, status: true, requestedAt: true },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "admissions.application.document_requested",
          entityType: "application_document",
          entityId: document.id,
          metadata: { applicationId, documentType: document.documentType },
        },
      });
      return document;
    });
  }

  async createOffer(schoolId: string, userId: string, applicationId: string, input: CreateOfferDto) {
    await this.requireAdmissionsRole(schoolId, userId);
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new BadRequestException("Offer expiry must be in the future.");
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.application.findFirst({ where: { schoolId, id: applicationId }, select: { id: true, status: true } });
      if (!application) throw new NotFoundException("Application not found.");
      if (!["reviewing", "documents_requested", "waitlisted"].includes(application.status)) {
        throw new BadRequestException("Application is not in a state that can receive an offer.");
      }
      const offer = await transaction.offer.create({
        data: {
          schoolId,
          applicationId,
          createdByUserId: userId,
          terms: input.terms.trim(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
        select: { id: true, status: true, offeredAt: true, expiresAt: true },
      });
      await transaction.application.update({ where: { schoolId_id: { schoolId, id: applicationId } }, data: { status: "offered" } });
      await transaction.applicationStatusHistory.create({
        data: { schoolId, applicationId, fromStatus: application.status, toStatus: "offered", actorUserId: userId },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "admissions.application.offer_created",
          entityType: "offer",
          entityId: offer.id,
          metadata: { applicationId },
        },
      });
      return offer;
    });
  }

  async respondToOffer(userId: string, applicationId: string, offerId: string, input: OfferResponseDto) {
    return this.prisma.$transaction(async (transaction) => {
      const application = await transaction.application.findFirst({
        where: { id: applicationId, applicantUserId: userId },
        select: { id: true, schoolId: true, status: true },
      });
      if (!application) throw new ForbiddenException("This offer is not linked to your parent account.");
      const offer = await transaction.offer.findFirst({
        where: { schoolId: application.schoolId, id: offerId, applicationId, status: "offered" },
        select: { id: true, expiresAt: true },
      });
      if (!offer) throw new NotFoundException("Active offer not found.");
      if (offer.expiresAt && offer.expiresAt < new Date()) throw new BadRequestException("Offer has expired.");
      const newStatus = input.response;
      await transaction.offer.update({
        where: { schoolId_id: { schoolId: application.schoolId, id: offerId } },
        data: { status: newStatus, respondedAt: new Date() },
      });
      const updated = await transaction.application.update({
        where: { schoolId_id: { schoolId: application.schoolId, id: applicationId } },
        data: { status: newStatus },
        select: { id: true, reference: true, status: true },
      });
      await transaction.applicationStatusHistory.create({
        data: {
          schoolId: application.schoolId,
          applicationId,
          fromStatus: application.status,
          toStatus: newStatus,
          actorUserId: userId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId: application.schoolId,
          actorUserId: userId,
          action: "admissions.application.offer_responded",
          entityType: "offer",
          entityId: offerId,
          metadata: { applicationId, response: newStatus },
        },
      });
      return updated;
    });
  }

  async listParentApplications(userId: string) {
    const applications = await this.prisma.application.findMany({
      where: { applicantUserId: userId },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        reference: true,
        pupilFirstName: true,
        pupilLastName: true,
        status: true,
        submittedAt: true,
        statusHistory: { orderBy: { changedAt: "desc" }, take: 20, select: { toStatus: true, changedAt: true } },
        documents: { select: { documentType: true, status: true, requestedAt: true, receivedAt: true } },
        offers: { where: { status: "offered" }, select: { id: true, terms: true, offeredAt: true, expiresAt: true } },
      },
    });
    return { items: applications, total: applications.length };
  }

  async createEnrolmentHandoff(
    schoolId: string,
    userId: string,
    applicationId: string,
    input: CreateEnrolmentHandoffDto,
  ) {
    await this.requireAdmissionsRole(schoolId, userId);
    const [application, year, yearGroup, form] = await Promise.all([
      this.prisma.application.findFirst({ where: { schoolId, id: applicationId }, select: { id: true, status: true, applicantUserId: true, pupilFirstName: true, pupilLastName: true, pupilDateOfBirth: true } }),
      this.prisma.academicYear.findFirst({ where: { schoolId, id: input.academicYearId }, select: { id: true } }),
      this.prisma.yearGroup.findFirst({ where: { schoolId, id: input.yearGroupId }, select: { id: true } }),
      this.prisma.form.findFirst({ where: { schoolId, id: input.formId, yearGroupId: input.yearGroupId }, select: { id: true } }),
    ]);
    if (!application) throw new NotFoundException("Application not found.");
    if (application.status !== "accepted") throw new BadRequestException("Only an accepted application can be handed off to enrolment.");
    if (!year || !yearGroup || !form) throw new BadRequestException("Academic year, year group, and form must match and belong to this school.");
    if (!application.applicantUserId) throw new BadRequestException("Link the accepted application to a parent account before enrolment.");
    const acceptedOffer = await this.prisma.offer.findFirst({
      where: { schoolId, applicationId, status: "accepted" },
      select: { id: true },
    });
    const parentMembership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId: application.applicantUserId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { id: true },
    });
    const parentPerson = await this.prisma.person.findFirst({
      where: { schoolId, userId: application.applicantUserId },
      select: { id: true, parentProfile: { select: { id: true } } },
    });
    if (!acceptedOffer || !parentMembership || !parentPerson?.parentProfile) {
      throw new BadRequestException("An accepted offer and verified active parent profile are required for enrolment.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const person = await transaction.person.create({
        data: {
          schoolId,
          legalFirstName: application.pupilFirstName,
          lastName: application.pupilLastName,
          dateOfBirth: application.pupilDateOfBirth,
        },
      });
      const pupil = await transaction.pupilProfile.create({
        data: {
          schoolId,
          personId: person.id,
          admissionNumber: `ADM-${randomUUID().slice(0, 12).toUpperCase()}`,
          admissionDate: dateOnly(new Date().toISOString()),
          status: "enrolled",
        },
      });
      await transaction.pupilEnrolment.create({
        data: {
          schoolId,
          pupilId: pupil.id,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          formId: input.formId,
          startsOn: dateOnly(new Date().toISOString()),
          status: "active",
        },
      });
      await transaction.pupilContact.create({
        data: {
          schoolId,
          pupilId: pupil.id,
          guardianPersonId: parentPerson.id,
          relationship: "parent",
          isPrimary: true,
          hasParentalResponsibility: true,
          canViewPortal: true,
          startsOn: dateOnly(new Date().toISOString()),
        },
      });
      const handoff = await transaction.enrolmentHandoff.create({
        data: {
          schoolId,
          applicationId,
          pupilId: pupil.id,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          formId: input.formId,
          verifiedByUserId: userId,
        },
      });
      await transaction.application.update({
        where: { schoolId_id: { schoolId, id: applicationId } },
        data: { status: "enrolled", enrolledPupilId: pupil.id },
      });
      await transaction.applicationStatusHistory.create({
        data: { schoolId, applicationId, fromStatus: "accepted", toStatus: "enrolled", actorUserId: userId },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: "admissions.application.enrolment_handoff_verified",
          entityType: "enrolment_handoff",
          entityId: handoff.id,
          metadata: { applicationId, pupilId: pupil.id, yearGroupId: input.yearGroupId, formId: input.formId },
        },
      });
      return { handoff, pupilId: pupil.id, admissionNumber: pupil.admissionNumber };
    });
  }

  private async requireAdmissionsRole(schoolId: string, userId: string): Promise<void> {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: { in: ADMISSIONS_ROLES } } } },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException("Admissions officer or leadership access is required.");
  }
}
