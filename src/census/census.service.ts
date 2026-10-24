import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { requireAnySchoolPermission } from "../auth/school-permissions";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CensusReadinessQueryDto,
  ListStaffComplianceQueryDto,
  UpdateStaffComplianceDto,
} from "./census.dto";

const complianceDateFields = [
  "identityVerifiedOn",
  "rightToWorkVerifiedOn",
  "dbsCheckedOn",
  "barredListCheckedOn",
  "prohibitionCheckedOn",
  "qualificationsVerifiedOn",
  "referencesVerifiedOn",
  "employmentHistoryVerifiedOn",
  "safeguardingTrainingCompletedOn",
] as const;

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException("Census date must be a valid calendar date.");
  }
  return date;
}

function dateInput(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return parseDateOnly(value);
}

@Injectable()
export class CensusService {
  constructor(private readonly prisma: PrismaService) {}

  async getReadiness(
    schoolId: string,
    userId: string,
    query: CensusReadinessQueryDto,
  ) {
    await requireAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["census.manage"],
      "Census readiness access is restricted to designated school leaders.",
    );
    const censusDate = parseDateOnly(
      query.censusDate ?? new Date().toISOString().slice(0, 10),
    );
    const enrolmentWhere: Prisma.PupilEnrolmentWhereInput = {
      status: "active",
      startsOn: { lte: censusDate },
      OR: [{ endsOn: null }, { endsOn: { gte: censusDate } }],
    };
    const pupilProfiles = await this.prisma.pupilProfile.findMany({
      where: {
        schoolId,
        status: "enrolled",
        admissionDate: { lte: censusDate },
      },
      select: {
        id: true,
        upn: true,
        admissionNumber: true,
        gender: true,
        person: {
          select: {
            legalFirstName: true,
            preferredName: true,
            lastName: true,
            dateOfBirth: true,
          },
        },
        enrolments: {
          where: enrolmentWhere,
          orderBy: { startsOn: "desc" },
          take: 1,
          select: { id: true, yearGroupId: true, formId: true },
        },
      },
    });
    const cohort = pupilProfiles.filter((pupil) => pupil.enrolments.length > 0);
    const examples = (
      rows: typeof pupilProfiles,
    ) => rows.slice(0, 8).map((pupil) => ({
      pupilId: pupil.id,
      admissionNumber: pupil.admissionNumber,
      name: `${pupil.person.preferredName || pupil.person.legalFirstName} ${pupil.person.lastName}`.trim(),
    }));
    const checks = [
      {
        key: "date_of_birth",
        label: "Date of birth recorded",
        description: "Pupil records need a date of birth for census validation.",
        missingCount: pupilProfiles.filter((pupil) => !pupil.person.dateOfBirth).length,
        examples: examples(pupilProfiles.filter((pupil) => !pupil.person.dateOfBirth)),
      },
      {
        key: "upn",
        label: "Unique pupil number recorded",
        description: "Pupil records need a UPN or an explicit correction outside this readiness check.",
        missingCount: pupilProfiles.filter((pupil) => !pupil.upn?.trim()).length,
        examples: examples(pupilProfiles.filter((pupil) => !pupil.upn?.trim())),
      },
      {
        key: "gender",
        label: "Sex recorded",
        description: "Pupil records marked as not recorded need review.",
        missingCount: pupilProfiles.filter((pupil) => !pupil.gender || pupil.gender === "not_recorded").length,
        examples: examples(pupilProfiles.filter((pupil) => !pupil.gender || pupil.gender === "not_recorded")),
      },
      {
        key: "enrolment",
        label: "Active enrolment on census date",
        description: "Every enrolled pupil should have an active year-group and form placement on the selected date.",
        missingCount: pupilProfiles.length - cohort.length,
        examples: examples(pupilProfiles.filter((pupil) => pupil.enrolments.length === 0)),
      },
    ].map((check) => ({
      ...check,
      status: check.missingCount > 0 ? "attention" : "complete",
    }));
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "census.readiness.viewed",
        entityType: "census_readiness",
        metadata: { censusDate: censusDate.toISOString().slice(0, 10), cohortCount: cohort.length },
      },
    });
    return {
      censusDate: censusDate.toISOString().slice(0, 10),
      cohortCount: cohort.length,
      status: cohort.length === 0 || checks.some((check) => check.missingCount > 0)
        ? "needs_attention"
        : "checks_complete",
      checks,
      limitation:
        "This check uses the selected date, currently stored pupil status, and enrolment dates. It does not validate every statutory field, apply DfE collection rules, or create an official census return.",
    };
  }

  async listStaffCompliance(
    schoolId: string,
    userId: string,
    query: ListStaffComplianceQueryDto,
  ) {
    await this.requireScrAccess(schoolId, userId);
    const search = query.search?.trim();
    const where: Prisma.StaffProfileWhereInput = {
      schoolId,
      ...(search
        ? {
            OR: [
              { staffNumber: { contains: search, mode: "insensitive" } },
              { jobTitle: { contains: search, mode: "insensitive" } },
              { person: { legalFirstName: { contains: search, mode: "insensitive" } } },
              { person: { preferredName: { contains: search, mode: "insensitive" } } },
              { person: { lastName: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [staff, total] = await Promise.all([
      this.prisma.staffProfile.findMany({
        where,
        orderBy: [{ person: { lastName: "asc" } }, { person: { legalFirstName: "asc" } }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          staffNumber: true,
          staffType: true,
          jobTitle: true,
          email: true,
          startDate: true,
          person: {
            select: { legalFirstName: true, preferredName: true, lastName: true },
          },
          complianceRecord: true,
        },
      }),
      this.prisma.staffProfile.count({ where }),
    ]);
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId: userId,
        action: "scr.records.viewed",
        entityType: "staff_compliance_record",
        metadata: { resultCount: staff.length },
      },
    });
    return {
      items: staff.map(({ person, ...row }) => ({
        ...row,
        name: `${person.preferredName || person.legalFirstName} ${person.lastName}`.trim(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async updateStaffCompliance(
    schoolId: string,
    userId: string,
    staffProfileId: string,
    input: UpdateStaffComplianceDto,
  ) {
    await this.requireScrAccess(schoolId, userId);
    const staff = await this.prisma.staffProfile.findFirst({
      where: { schoolId, id: staffProfileId },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException("Staff member not found.");

    const where = { schoolId_staffProfileId: { schoolId, staffProfileId } };
    const existing = await this.prisma.staffComplianceRecord.findUnique({
      where,
      select: { id: true },
    });
    const data: Prisma.StaffComplianceRecordUncheckedUpdateInput = {
      dbsCheckStatus: input.dbsCheckStatus,
      updatedByUserId: userId,
    };
    for (const field of complianceDateFields) {
      const value = input[field];
      if (value !== undefined) data[field] = dateInput(value);
    }

    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.staffComplianceRecord.upsert({
        where,
        create: {
          schoolId,
          staffProfileId,
          updatedByUserId: userId,
          dbsCheckStatus: input.dbsCheckStatus,
          ...Object.fromEntries(
            complianceDateFields.map((field) => [field, dateInput(input[field]) ?? null]),
          ),
        },
        update: data,
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId: userId,
          action: existing ? "scr.record.updated" : "scr.record.created",
          entityType: "staff_compliance_record",
          entityId: record.id,
          metadata: { staffProfileId, changedFields: ["dbsCheckStatus", ...complianceDateFields.filter((field) => input[field] !== undefined)] },
        },
      });
      return record;
    });
  }

  private requireScrAccess(schoolId: string, userId: string) {
    return requireAnySchoolPermission(
      this.prisma,
      schoolId,
      userId,
      ["scr.manage"],
      "Single Central Record access is restricted to designated school leaders and SCR administrators.",
    );
  }
}
