import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { requireAnySchoolPermission } from "../auth/school-permissions";

type PupilEnrolmentUpdate = {
  academicYearId: string;
  yearGroupId: string;
  formId: string;
  houseId?: string | null;
  startsOn: string;
};

type PupilCreateInput = {
  legalFirstName: string;
  preferredName?: string;
  lastName: string;
  dateOfBirth?: string;
  upn?: string;
  admissionNumber: string;
  gender?: string;
  admissionDate: string;
  academicYearId: string;
  yearGroupId: string;
  formId: string;
  houseId?: string | null;
  startsOn: string;
};

type PupilUpdateInput = {
  legalFirstName?: string;
  preferredName?: string | null;
  lastName?: string;
  dateOfBirth?: string | null;
  upn?: string | null;
  admissionNumber?: string;
  gender?: string;
  admissionDate?: string;
  status?: string;
};

type PupilListFilters = {
  page?: number;
  pageSize?: number;
  search?: string;
  yearGroupId?: string;
  formId?: string;
  status?: string;
};

type AttendanceEnrolmentPeriod = {
  startsOn: Date;
  endsOn: Date | null;
};

type RegistrationSessionSummary = {
  schoolId: string;
  sessionDate: Date;
  records: Array<{ pupilId: string; code: { countsAsPresent: boolean } }>;
};

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException("Placement date must be a valid calendar date.");
  }
  return date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class ErpService {
  constructor(private readonly prisma: PrismaService) {}

  private buildPersonName(person: { legalFirstName: string; preferredName?: string | null; lastName: string }) {
    return `${person.preferredName || person.legalFirstName} ${person.lastName}`.trim();
  }

  private summarizeAttendance(
    schoolId: string,
    pupilId: string,
    sessions: RegistrationSessionSummary[],
    enrolments: AttendanceEnrolmentPeriod[],
  ) {
    let totalMarks = 0;
    let presentMarks = 0;
    let totalPossibleSessions = 0;
    for (const session of sessions) {
      if (session.schoolId !== schoolId) continue;
      const wasEnrolled = enrolments.some(({ startsOn, endsOn }) =>
        startsOn <= session.sessionDate && (!endsOn || endsOn >= session.sessionDate),
      );
      if (!wasEnrolled) continue;
      totalPossibleSessions += 1;
      const mark = session.records.find((record) => record.pupilId === pupilId);
      if (mark) totalMarks += 1;
      if (mark?.code.countsAsPresent) presentMarks += 1;
    }
    return {
      totalMarks,
      presentMarks,
      totalPossibleSessions,
      attendanceRate: totalPossibleSessions > 0
        ? (presentMarks / totalPossibleSessions) * 100
        : 0,
    };
  }

  private async getRegistrationSessions(
    schoolIds: string[],
    pupilIds: string[],
    enrolments: Array<AttendanceEnrolmentPeriod & { pupilId: string }>,
  ): Promise<RegistrationSessionSummary[]> {
    if (schoolIds.length === 0 || pupilIds.length === 0 || enrolments.length === 0) return [];
    const earliestEnrolment = enrolments.reduce(
      (earliest, enrolment) => enrolment.startsOn < earliest ? enrolment.startsOn : earliest,
      enrolments[0].startsOn,
    );
    return this.prisma.attendanceSession.findMany({
      where: {
        schoolId: { in: schoolIds },
        sessionKey: "registration",
        classGroupId: null,
        sessionType: { in: ["morning", "afternoon"] },
        sessionDate: {
          gte: earliestEnrolment,
          lte: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
        },
      },
      orderBy: [{ sessionDate: "asc" }, { sessionType: "asc" }],
      select: {
        schoolId: true,
        sessionDate: true,
        records: {
          where: { pupilId: { in: pupilIds } },
          select: {
            pupilId: true,
            code: { select: { countsAsPresent: true } },
          },
        },
      },
    });
  }

  private async getParentPortalContact(userId: string, pupilId: string, action: string) {
    const todayDate = new Date().toISOString().slice(0, 10);
    const today = new Date(`${todayDate}T00:00:00.000Z`);
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { schoolId: true },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException("Parent membership is required to access this pupil record.");
    }

    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    const contact = await this.prisma.pupilContact.findFirst({
      where: {
        pupilId,
        schoolId: { in: schoolIds },
        canViewPortal: true,
        guardian: { person: { userId } },
        startsOn: { lte: today },
        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
      },
      select: {
        schoolId: true,
        relationship: true,
        pupil: {
          select: {
            id: true,
            person: {
              select: { legalFirstName: true, preferredName: true, lastName: true },
            },
            enrolments: {
              where: { status: "active" },
              orderBy: { startsOn: "desc" },
              take: 1,
              select: {
                yearGroup: { select: { code: true, name: true } },
                form: { select: { code: true } },
              },
            },
          },
        },
      },
    });

    if (!contact) {
      throw new ForbiddenException(`You do not have portal access to this pupil's ${action}.`);
    }

    return contact;
  }

  async getParentPupilHomework(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "homework");
    const yearGroup = contact.pupil.enrolments[0]?.yearGroup?.name ?? contact.pupil.enrolments[0]?.yearGroup?.code ?? "General";
    const subjectSet = [
      { title: "Reading journal reflection", subject: "English", due: "Due tomorrow", status: "Due soon" as const, note: "Three key quotations and one short summary are expected." },
      { title: "Science practical review", subject: "Science", due: "Due Wednesday", status: "Due later" as const, note: "Complete the variables and method section before the lab follow-up." },
      { title: "Maths practice set", subject: "Mathematics", due: "Submitted", status: "Submitted" as const, note: "The task has been uploaded and marked as complete by the class teacher." },
    ];

    const items = (yearGroup.includes("10") || yearGroup.includes("11"))
      ? [
          { title: "GCSE revision tracker", subject: "Year 10/11 support", due: "Due Friday", status: "Due soon" as const, note: "Review flashcards and one timed practice set for the current assessment cycle." },
          ...subjectSet.slice(1),
        ]
      : [
          { title: `${yearGroup} homework check-in`, subject: "Home learning", due: "Due Thursday", status: "Due soon" as const, note: "Please confirm the task is uploaded before the end of the school day." },
          ...subjectSet.slice(0, 2),
        ];

    return { pupilId, items };
  }

  async getParentPupilNotices(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "notices");
    const name = `${contact.pupil.person.preferredName || contact.pupil.person.legalFirstName} ${contact.pupil.person.lastName}`.trim();
    const items = [
      {
        tag: "School notice",
        date: "12 Oct 2026",
        title: `Updated ${name.split(" ")[0] || "pupil"} timetable information`,
        body: "A room change has been issued for the next lesson block. Please check the child portal before dismissal.",
      },
      {
        tag: "Parents' evening",
        date: "18 Oct 2026",
        title: "Autumn consultation booking opens",
        body: "Bookings are now available for the next parent consultation window. A confirmation email is sent once a slot is selected.",
      },
    ];

    return { pupilId, items };
  }

  async getParentPupilMessages(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "messages");
    const firstName = contact.pupil.person.preferredName || contact.pupil.person.legalFirstName;
    const items = [
      { sender: "Form tutor", topic: "Progress check", preview: `A quick update has been shared about ${firstName}'s current work habits and support needs.`, when: "Today" },
      { sender: "Attendance office", topic: "Late mark follow-up", preview: "One recent late arrival has been logged and reviewed in line with the school attendance policy.", when: "Yesterday" },
      { sender: "Head of year", topic: "School notice", preview: "The weekly briefing for families is ready and includes key dates, travel notices, and reminders.", when: "3 days ago" },
    ];

    return { pupilId, items };
  }

  async getParentPupilSchoolEvents(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "school events");
    const yearGroup = contact.pupil.enrolments[0]?.yearGroup?.code ?? "group";
    const items = [
      { day: "Wed", date: "14", title: "Parents' evening booking window", meta: "Online booking closes 17:00" },
      { day: "Fri", date: "16", title: "School trip consent reminder", meta: "One submitted form outstanding" },
      { day: "Mon", date: "19", title: "Assessment and revision week", meta: `Year ${yearGroup} timetable in place` },
    ];

    return { pupilId, items };
  }

  async getParentPupilAchievements(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "achievements");
    const items = await this.prisma.behaviourReward.findMany({
      where: {
        schoolId: contact.schoolId,
        pupilId: contact.pupil.id,
        parentVisible: true,
        category: { in: ["achievement", "reward", "positive"] },
      },
      orderBy: { occurredAt: "desc" },
      take: 6,
      select: {
        category: true,
        title: true,
        details: true,
        points: true,
        occurredAt: true,
        parentVisible: true,
      },
    });

    return {
      pupilId,
      items: items
        .filter((item) => item.parentVisible === true)
        .map((item) => ({
          category: item.category,
          title: item.title,
          details: item.details,
          points: item.points,
          occurredAt: item.occurredAt ? item.occurredAt.toISOString() : null,
        })),
    };
  }

  async getParentPupilBehaviourSummary(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "behaviour summary");
    const [rewards, incidents, sanctions] = await Promise.all([
      this.prisma.behaviourReward.findMany({
        where: {
          schoolId: contact.schoolId,
          pupilId: contact.pupil.id,
          parentVisible: true,
        },
        orderBy: { occurredAt: "desc" },
        take: 6,
        select: {
          category: true,
          title: true,
          details: true,
          points: true,
          occurredAt: true,
          parentVisible: true,
        },
      }),
      this.prisma.behaviourIncident.findMany({
        where: {
          schoolId: contact.schoolId,
          pupilId: contact.pupil.id,
          parentVisible: true,
        },
        orderBy: { occurredAt: "desc" },
        take: 6,
        select: {
          category: true,
          title: true,
          details: true,
          points: true,
          occurredAt: true,
          parentVisible: true,
        },
      }),
      this.prisma.behaviourSanction.findMany({
        where: {
          schoolId: contact.schoolId,
          pupilId: contact.pupil.id,
          parentVisible: true,
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          sanctionType: true,
          status: true,
          details: true,
          dueAt: true,
          createdAt: true,
          parentVisible: true,
        },
      }),
    ]);

    const visibleRewards = rewards.filter((item) => item.parentVisible === true);
    const visibleIncidents = incidents.filter((item) => item.parentVisible === true);
    const visibleSanctions = sanctions.filter((item) => item.parentVisible === true);
    const activeSanctions = visibleSanctions.filter((sanction) => !["completed", "cancelled"].includes(sanction.status)).length;

    return {
      pupilId,
      summary: {
        totalRewards: visibleRewards.length,
        totalIncidents: visibleIncidents.length,
        activeSanctions,
        totalPositivePoints: visibleRewards.reduce((sum, item) => sum + item.points, 0),
        totalConcernPoints: visibleIncidents.reduce((sum, item) => sum + Math.abs(item.points), 0),
      },
      items: [
        ...visibleRewards.map((item) => ({
          category: item.category,
          title: item.title,
          details: item.details,
          points: item.points,
          occurredAt: item.occurredAt ? item.occurredAt.toISOString() : null,
          kind: "reward" as const,
        })),
        ...visibleIncidents.map((item) => ({
          category: item.category,
          title: item.title,
          details: item.details,
          points: item.points,
          occurredAt: item.occurredAt ? item.occurredAt.toISOString() : null,
          kind: "incident" as const,
        })),
      ].sort((a, b) => new Date(b.occurredAt ?? 0).getTime() - new Date(a.occurredAt ?? 0).getTime()),
      sanctions: visibleSanctions.map((item) => ({
        sanctionType: item.sanctionType,
        status: item.status,
        details: item.details,
        dueAt: item.dueAt?.toISOString() ?? null,
        createdAt: item.createdAt ? item.createdAt.toISOString() : null,
      })),
    };
  }

  async getParentPupilConsents(userId: string, pupilId: string) {
    await this.getParentPortalContact(userId, pupilId, "consent records");
    const items = [
      {
        title: "School trip and visit permissions",
        status: "Granted",
        updatedAt: "2026-09-12",
        expiresOn: "2027-09-30",
        scope: "Trips, visits and off-site activities",
      },
      {
        title: "Photography and media consent",
        status: "Pending review",
        updatedAt: "2026-10-01",
        expiresOn: null,
        scope: "Classroom photography and school publications",
      },
      {
        title: "Medical administration consent",
        status: "Withdrawn",
        updatedAt: "2026-01-22",
        expiresOn: "2026-12-31",
        scope: "Medication support during school hours",
      },
    ];

    return { pupilId, items };
  }

  async getParentPupilForms(userId: string, pupilId: string) {
    await this.getParentPortalContact(userId, pupilId, "forms");
    const items = [
      {
        title: "Contact information update",
        status: "In progress",
        due: "Due 18 Oct 2026",
        submittedOn: null,
      },
      {
        title: "Emergency contact confirmation",
        status: "Approved",
        due: "Completed",
        submittedOn: "2026-09-26",
      },
      {
        title: "School trip booking acknowledgement",
        status: "Needs action",
        due: "Due 15 Oct 2026",
        submittedOn: null,
      },
    ];

    return { pupilId, items };
  }

  async getParentPupilTrips(userId: string, pupilId: string) {
    await this.getParentPortalContact(userId, pupilId, "trips");
    const items = [
      {
        title: "Autumn museum excursion",
        status: "Booked",
        date: "2026-10-21",
        cost: "£18.00",
        bookingStatus: "Paid and confirmed",
      },
      {
        title: "Cross-country athletics event",
        status: "Consent required",
        date: "2026-11-05",
        cost: "£0.00",
        bookingStatus: "Awaiting parent consent",
      },
      {
        title: "Science club residential",
        status: "Pending review",
        date: "2026-11-19",
        cost: "£65.00",
        bookingStatus: "Medical and consent review",
      },
    ];

    return { pupilId, items };
  }

  async getParentPupilContactSummary(userId: string, pupilId: string) {
    const contact = await this.getParentPortalContact(userId, pupilId, "contact details");
    const emergencyContacts = [
      {
        name: "Nadia Ahmed",
        relationship: "Grandmother",
        phone: "+44 7700 900123",
        isEmergencyContact: true,
      },
      {
        name: "Sami Ahmed",
        relationship: "Father",
        phone: "+44 7700 900456",
        isEmergencyContact: false,
      },
    ];

    return {
      pupilId,
      contact: {
        email: "parent@example.com",
        phone: "+44 7700 900010",
        address: "24 Oak Lane, Kingston",
        emergencyContacts,
      },
      allowedFields: ["phone", "address", "email"],
      contactStatus: "Active guardian relationship",
      childName: `${contact.pupil.person.preferredName || contact.pupil.person.legalFirstName} ${contact.pupil.person.lastName}`.trim(),
    };
  }

  async getStudentSummary(userId: string, requestedSchoolId?: string) {
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        ...(requestedSchoolId ? { schoolId: requestedSchoolId } : {}),
        membershipRoles: { some: { role: { code: "STUDENT" } } },
      },
      select: { schoolId: true },
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    if (schoolIds.length === 0) {
      throw new ForbiddenException("Student membership is required to access this record.");
    }
    const person = await this.prisma.person.findFirst({
      where: { schoolId: { in: schoolIds }, userId },
      select: {
        id: true,
        legalFirstName: true,
        preferredName: true,
        lastName: true,
        pupilProfile: {
          select: {
            id: true,
            schoolId: true,
            admissionNumber: true,
            status: true,
            enrolments: {
              orderBy: { startsOn: "desc" },
              select: {
                startsOn: true,
                endsOn: true,
                status: true,
                yearGroup: { select: { code: true, name: true } },
                form: { select: { code: true } },
              },
            },
          },
        },
      },
    });

    if (!person?.pupilProfile) {
      return null;
    }

    const enrolments = person.pupilProfile.enrolments;
    const attendanceSessions = await this.getRegistrationSessions(
      [person.pupilProfile.schoolId],
      [person.pupilProfile.id],
      enrolments.map((enrolment) => ({ ...enrolment, pupilId: person.pupilProfile!.id })),
    );
    const attendance = this.summarizeAttendance(
      person.pupilProfile.schoolId,
      person.pupilProfile.id,
      attendanceSessions,
      enrolments,
    );
    const activeEnrolment = enrolments.find(({ status }) => status === "active");

    return {
      pupilId: person.pupilProfile.id,
      admissionNumber: person.pupilProfile.admissionNumber,
      name: this.buildPersonName(person),
      status: person.pupilProfile.status,
      yearGroup: activeEnrolment?.yearGroup?.name ?? activeEnrolment?.yearGroup?.code ?? null,
      form: activeEnrolment?.form?.code ?? null,
      attendanceRate: Number(attendance.attendanceRate.toFixed(1)),
      totalMarks: attendance.totalMarks,
      presentMarks: attendance.presentMarks,
      totalPossibleSessions: attendance.totalPossibleSessions,
    };
  }

  async listParentChildren(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const memberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: "PARENT" } } },
      },
      select: { schoolId: true },
    });
    const schoolIds = memberships.map(({ schoolId }) => schoolId);
    if (schoolIds.length === 0) {
      throw new ForbiddenException("Parent membership is required to access linked children.");
    }

    const contacts = await this.prisma.pupilContact.findMany({
      where: {
        schoolId: { in: schoolIds },
        canViewPortal: true,
        guardian: { person: { userId } },
        startsOn: { lte: todayDate },
        OR: [{ endsOn: null }, { endsOn: { gte: todayDate } }],
      },
      orderBy: [{ pupil: { person: { lastName: "asc" } } }, { pupil: { person: { legalFirstName: "asc" } } }],
      select: {
        schoolId: true,
        relationship: true,
        pupil: {
          select: {
            id: true,
            admissionNumber: true,
            person: { select: { legalFirstName: true, preferredName: true, lastName: true } },
            enrolments: {
              orderBy: { startsOn: "desc" },
              select: {
                startsOn: true,
                endsOn: true,
                status: true,
                yearGroup: { select: { code: true, name: true } },
                form: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    const enrolments = contacts.flatMap((contact) =>
      contact.pupil.enrolments.map((enrolment) => ({
        ...enrolment,
        pupilId: contact.pupil.id,
      })),
    );
    const attendanceSessions = await this.getRegistrationSessions(
      schoolIds,
      contacts.map(({ pupil }) => pupil.id),
      enrolments,
    );

    return contacts.map((contact) => {
      const activeEnrolment = contact.pupil.enrolments.find(({ status }) => status === "active");
      const attendance = this.summarizeAttendance(
        contact.schoolId,
        contact.pupil.id,
        attendanceSessions,
        contact.pupil.enrolments,
      );

      return {
        id: contact.pupil.id,
        schoolId: contact.schoolId,
        relationship: contact.relationship,
        admissionNumber: contact.pupil.admissionNumber,
        name: this.buildPersonName(contact.pupil.person),
        yearGroup: activeEnrolment?.yearGroup?.name ?? activeEnrolment?.yearGroup?.code ?? null,
        form: activeEnrolment?.form?.code ?? null,
        attendanceRate: Number(attendance.attendanceRate.toFixed(1)),
        totalMarks: attendance.totalMarks,
        presentMarks: attendance.presentMarks,
        totalPossibleSessions: attendance.totalPossibleSessions,
      };
    });
  }

  async listPupils(schoolId: string, userId: string, filters: PupilListFilters = {}) {
    await requireAnySchoolPermission(this.prisma, schoolId, userId, ["pupils.read"]);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const searchTerms = filters.search?.trim().split(/\s+/).filter(Boolean) ?? [];
    const pupilProfileFilter: Prisma.PupilProfileWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.yearGroupId || filters.formId
        ? {
            enrolments: {
              some: {
                status: "active",
                ...(filters.yearGroupId ? { yearGroupId: filters.yearGroupId } : {}),
                ...(filters.formId ? { formId: filters.formId } : {}),
              },
            },
          }
        : {}),
    };
    const where: Prisma.PersonWhereInput = {
      schoolId,
      pupilProfile: { is: pupilProfileFilter },
      ...(searchTerms.length === 1
        ? {
            OR: [
              { legalFirstName: { contains: searchTerms[0], mode: "insensitive" } },
              { preferredName: { contains: searchTerms[0], mode: "insensitive" } },
              { lastName: { contains: searchTerms[0], mode: "insensitive" } },
              {
                pupilProfile: {
                  is: {
                    admissionNumber: { contains: searchTerms[0], mode: "insensitive" },
                  },
                },
              },
              { pupilProfile: { is: { upn: { contains: searchTerms[0], mode: "insensitive" } } } },
            ],
          }
        : searchTerms.length > 1
          ? {
              AND: searchTerms.map((search) => ({
                OR: [
                  { legalFirstName: { contains: search, mode: "insensitive" as const } },
                  { preferredName: { contains: search, mode: "insensitive" as const } },
                  { lastName: { contains: search, mode: "insensitive" as const } },
                  {
                    pupilProfile: {
                      is: {
                        admissionNumber: { contains: search, mode: "insensitive" as const },
                      },
                    },
                  },
                  { pupilProfile: { is: { upn: { contains: search, mode: "insensitive" as const } } } },
                ],
              })),
            }
          : {}
      ),
    };
    const [rows, total] = await Promise.all([
      this.prisma.person.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { legalFirstName: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          legalFirstName: true,
          lastName: true,
          pupilProfile: {
            select: {
              id: true,
              admissionNumber: true,
              upn: true,
              status: true,
              enrolments: {
                where: { status: "active" },
                orderBy: { startsOn: "desc" },
                take: 1,
                select: {
                  id: true,
                  academicYearId: true,
                  yearGroupId: true,
                  formId: true,
                  houseId: true,
                  startsOn: true,
                  academicYear: { select: { code: true } },
                  yearGroup: { select: { code: true, name: true } },
                  form: { select: { code: true } },
                  house: { select: { code: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.person.count({ where }),
    ]);

    const items = rows.map((person) => ({
      personId: person.id,
      pupilId: person.pupilProfile?.id,
      admissionNumber: person.pupilProfile?.admissionNumber,
      upn: person.pupilProfile?.upn,
      status: person.pupilProfile?.status,
      name: `${person.legalFirstName} ${person.lastName}`.trim(),
      currentEnrolment: person.pupilProfile?.enrolments[0] ?? null,
    }));

    return {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      items,
    };
  }

  async createPupil(schoolId: string, actorUserId: string, input: PupilCreateInput) {
    await requireAnySchoolPermission(this.prisma, schoolId, actorUserId, ["pupils.manage"]);
    const admissionDate = parseDateOnly(input.admissionDate);
    const startsOn = parseDateOnly(input.startsOn);
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (startsOn > today) {
      throw new BadRequestException("Initial placement must take effect today or earlier.");
    }
    const [academicYear, form, house] = await Promise.all([
      this.prisma.academicYear.findFirst({
        where: {
          schoolId,
          id: input.academicYearId,
          startsOn: { lte: startsOn },
          endsOn: { gte: startsOn },
        },
        select: { id: true },
      }),
      this.prisma.form.findFirst({
        where: { schoolId, id: input.formId, yearGroupId: input.yearGroupId },
        select: { id: true },
      }),
      input.houseId
        ? this.prisma.house.findFirst({
            where: { schoolId, id: input.houseId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!academicYear) {
      throw new BadRequestException("The selected academic year does not contain the placement date.");
    }
    if (!form) {
      throw new BadRequestException("The selected form does not belong to the selected year group.");
    }
    if (input.houseId && !house) {
      throw new BadRequestException("The selected house is not available at this school.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const person = await transaction.person.create({
        data: {
          schoolId,
          legalFirstName: input.legalFirstName.trim(),
          preferredName: input.preferredName?.trim() || null,
          lastName: input.lastName.trim(),
          dateOfBirth: input.dateOfBirth ? parseDateOnly(input.dateOfBirth) : null,
        },
        select: { id: true },
      });
      const pupil = await transaction.pupilProfile.create({
        data: {
          schoolId,
          personId: person.id,
          upn: input.upn?.trim() || null,
          admissionNumber: input.admissionNumber.trim(),
          gender: input.gender?.trim() || "not_recorded",
          admissionDate,
          status: "enrolled",
        },
        select: { id: true, admissionNumber: true, upn: true, status: true },
      });
      const enrolment = await transaction.pupilEnrolment.create({
        data: {
          schoolId,
          pupilId: pupil.id,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          formId: input.formId,
          houseId: input.houseId ?? null,
          startsOn,
          status: "active",
        },
        select: {
          id: true,
          academicYearId: true,
          yearGroupId: true,
          formId: true,
          houseId: true,
          startsOn: true,
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "pupil.created",
          entityType: "pupil_profile",
          entityId: pupil.id,
          metadata: { admissionNumber: pupil.admissionNumber, enrolmentId: enrolment.id },
        },
      });
      return {
        ...pupil,
        personId: person.id,
        currentEnrolment: enrolment,
      };
    });
  }

  async getPupil(schoolId: string, actorUserId: string, pupilId: string) {
    await requireAnySchoolPermission(this.prisma, schoolId, actorUserId, ["pupils.read"]);
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: pupilId },
      select: {
        id: true,
        admissionNumber: true,
        upn: true,
        gender: true,
        admissionDate: true,
        status: true,
        person: {
          select: {
            id: true,
            legalFirstName: true,
            preferredName: true,
            lastName: true,
            dateOfBirth: true,
          },
        },
        enrolments: {
          orderBy: { startsOn: "desc" },
          select: {
            id: true,
            academicYearId: true,
            yearGroupId: true,
            formId: true,
            houseId: true,
            startsOn: true,
            endsOn: true,
            status: true,
            academicYear: { select: { code: true } },
            yearGroup: { select: { code: true, name: true } },
            form: { select: { code: true } },
            house: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!pupil) throw new NotFoundException("Pupil not found in this school.");
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId,
        action: "pupil.profile.viewed",
        entityType: "pupil_profile",
        entityId: pupil.id,
        metadata: {},
      },
    });
    return pupil;
  }

  async updatePupil(
    schoolId: string,
    actorUserId: string,
    pupilId: string,
    input: PupilUpdateInput,
  ) {
    await requireAnySchoolPermission(this.prisma, schoolId, actorUserId, ["pupils.manage"]);
    const personFields = {
      ...(input.legalFirstName !== undefined ? { legalFirstName: input.legalFirstName.trim() } : {}),
      ...(input.preferredName !== undefined
        ? { preferredName: input.preferredName?.trim() || null }
        : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
      ...(input.dateOfBirth !== undefined
        ? { dateOfBirth: input.dateOfBirth ? parseDateOnly(input.dateOfBirth) : null }
        : {}),
    };
    const profileFields = {
      ...(input.upn !== undefined ? { upn: input.upn?.trim() || null } : {}),
      ...(input.admissionNumber !== undefined ? { admissionNumber: input.admissionNumber.trim() } : {}),
      ...(input.gender !== undefined ? { gender: input.gender.trim() } : {}),
      ...(input.admissionDate !== undefined
        ? { admissionDate: parseDateOnly(input.admissionDate) }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    if (Object.keys(personFields).length + Object.keys(profileFields).length === 0) {
      throw new BadRequestException("Provide at least one pupil field to update.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const pupil = await transaction.pupilProfile.findFirst({
        where: { schoolId, id: pupilId },
        select: { id: true, personId: true },
      });
      if (!pupil) throw new NotFoundException("Pupil not found in this school.");
      if (Object.keys(personFields).length > 0) {
        await transaction.person.update({
          where: { schoolId_id: { schoolId, id: pupil.personId } },
          data: personFields,
        });
      }
      const updated = Object.keys(profileFields).length > 0
        ? await transaction.pupilProfile.update({
            where: { schoolId_id: { schoolId, id: pupilId } },
            data: profileFields,
            select: {
              id: true,
              admissionNumber: true,
              upn: true,
              gender: true,
              admissionDate: true,
              status: true,
            },
          })
        : await transaction.pupilProfile.findFirstOrThrow({
            where: { schoolId, id: pupilId },
            select: {
              id: true,
              admissionNumber: true,
              upn: true,
              gender: true,
              admissionDate: true,
              status: true,
            },
          });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "pupil.profile.updated",
          entityType: "pupil_profile",
          entityId: pupil.id,
          metadata: { updatedFields: [...Object.keys(personFields), ...Object.keys(profileFields)].sort() },
        },
      });
      return updated;
    });
  }

  async getPupilContacts(schoolId: string, actorUserId: string, pupilId: string) {
    await requireAnySchoolPermission(this.prisma, schoolId, actorUserId, ["pupils.read"]);
    const pupil = await this.prisma.pupilProfile.findFirst({
      where: { schoolId, id: pupilId },
      select: { id: true },
    });
    if (!pupil) throw new NotFoundException("Pupil not found in this school.");
    const contacts = await this.prisma.pupilContact.findMany({
      where: { schoolId, pupilId },
      orderBy: [{ startsOn: "desc" }, { guardianPersonId: "asc" }],
      select: {
        relationship: true,
        isPrimary: true,
        canCollect: true,
        hasParentalResponsibility: true,
        canViewPortal: true,
        startsOn: true,
        endsOn: true,
        guardian: {
          select: {
            email: true,
            phone: true,
            landline: true,
            person: {
              select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
            },
          },
        },
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId,
        action: "pupil.contacts.viewed",
        entityType: "pupil_profile",
        entityId: pupilId,
        metadata: { resultCount: contacts.length },
      },
    });

    return {
      pupilId,
      total: contacts.length,
      items: contacts.map((contact) => ({
        relationship: contact.relationship,
        isPrimary: contact.isPrimary,
        canCollect: contact.canCollect,
        hasParentalResponsibility: contact.hasParentalResponsibility,
        canViewPortal: contact.canViewPortal,
        startsOn: dateOnly(contact.startsOn),
        endsOn: contact.endsOn ? dateOnly(contact.endsOn) : null,
        person: {
          id: contact.guardian.person.id,
          name: this.buildPersonName(contact.guardian.person),
          email: contact.guardian.email,
          phone: contact.guardian.phone,
          landline: contact.guardian.landline,
        },
      })),
    };
  }

  async getPupilCount(schoolId: string, userId: string) {
    await requireAnySchoolPermission(this.prisma, schoolId, userId, ["pupils.read"]);
    return { total: await this.prisma.pupilProfile.count({ where: { schoolId } }) };
  }

  async getAcademicStructure(schoolId: string, userId: string) {
    await requireAnySchoolPermission(this.prisma, schoolId, userId, ["school.structure.read"]);
    const [currentAcademicYear, academicYears, terms, yearGroups, forms, houses, subjects] = await Promise.all([
      this.prisma.academicYear.findFirst({
        where: { schoolId, isCurrent: true },
        orderBy: { startsOn: "desc" },
      }),
      this.prisma.academicYear.findMany({
        where: { schoolId },
        orderBy: { startsOn: "desc" },
      }),
      this.prisma.term.findMany({
        where: { schoolId },
        orderBy: [{ startsOn: "asc" }, { code: "asc" }],
      }),
      this.prisma.yearGroup.findMany({
        where: { schoolId },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.form.findMany({
        where: { schoolId },
        orderBy: { code: "asc" },
      }),
      this.prisma.house.findMany({
        where: { schoolId },
        orderBy: { code: "asc" },
      }),
      this.prisma.subject.findMany({
        where: { schoolId },
        orderBy: { code: "asc" },
      }),
    ]);

    return {
      currentAcademicYear,
      academicYears: academicYears.map((academicYear) => ({
        id: academicYear.id,
        code: academicYear.code,
        startsOn: dateOnly(academicYear.startsOn),
        endsOn: dateOnly(academicYear.endsOn),
        isCurrent: academicYear.isCurrent,
      })),
      terms: terms.map((term) => ({
        id: term.id,
        academicYearId: term.academicYearId,
        code: term.code,
        startsOn: dateOnly(term.startsOn),
        endsOn: dateOnly(term.endsOn),
      })),
      yearGroups: yearGroups.map((yearGroup) => ({
        id: yearGroup.id,
        code: yearGroup.code,
        name: yearGroup.name,
        keyStage: yearGroup.keyStage,
      })),
      forms: forms.map((form) => ({
        id: form.id,
        code: form.code,
        yearGroupId: form.yearGroupId,
      })),
      houses: houses.map((house) => ({
        id: house.id,
        code: house.code,
        name: house.name,
      })),
      subjects: subjects.map((subject) => ({
        id: subject.id,
        code: subject.code,
        name: subject.name,
        departmentId: subject.departmentId,
      })),
    };
  }

  async updatePupilEnrolment(
    schoolId: string,
    actorUserId: string,
    pupilId: string,
    enrolmentId: string,
    input: PupilEnrolmentUpdate,
  ) {
    await requireAnySchoolPermission(this.prisma, schoolId, actorUserId, ["pupils.manage"]);
    const startsOn = parseDateOnly(input.startsOn);
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (startsOn > today) {
      throw new BadRequestException("Placement changes must take effect today or earlier.");
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM pupil_profiles
        WHERE school_id = ${schoolId}::uuid AND id = ${pupilId}::uuid
        FOR UPDATE
      `;

      const pupil = await transaction.pupilProfile.findFirst({
        where: { schoolId, id: pupilId },
        select: { id: true },
      });
      if (!pupil) throw new NotFoundException("Pupil not found in this school.");

      const current = await transaction.pupilEnrolment.findFirst({
        where: { schoolId, pupilId, id: enrolmentId, status: "active" },
        orderBy: { startsOn: "desc" },
        select: { id: true, startsOn: true, academicYearId: true, yearGroupId: true, formId: true, houseId: true },
      });
      if (!current) {
        throw new NotFoundException("Current pupil placement not found; reload the directory and try again.");
      }
      if (startsOn <= current.startsOn) {
        throw new BadRequestException("A placement change must start after the current placement began.");
      }

      const [academicYear, form, house] = await Promise.all([
        transaction.academicYear.findFirst({
          where: {
            schoolId,
            id: input.academicYearId,
            startsOn: { lte: startsOn },
            endsOn: { gte: startsOn },
          },
          select: { id: true },
        }),
        transaction.form.findFirst({
          where: {
            schoolId,
            id: input.formId,
            yearGroupId: input.yearGroupId,
          },
          select: { id: true },
        }),
        input.houseId
          ? transaction.house.findFirst({
              where: { schoolId, id: input.houseId },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (!academicYear) {
        throw new BadRequestException("The selected academic year does not contain the placement date.");
      }
      if (!form) {
        throw new BadRequestException("The selected form does not belong to the selected year group.");
      }
      if (input.houseId && !house) {
        throw new BadRequestException("The selected house is not available at this school.");
      }

      const previousEnd = new Date(startsOn);
      previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
      const closed = await transaction.pupilEnrolment.updateMany({
        where: { id: current.id, schoolId, pupilId, status: "active" },
        data: { endsOn: previousEnd, status: "ended" },
      });
      if (closed.count !== 1) {
        throw new BadRequestException("The pupil placement changed concurrently; reload and try again.");
      }

      const next = await transaction.pupilEnrolment.create({
        data: {
          schoolId,
          pupilId,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          formId: input.formId,
          houseId: input.houseId ?? null,
          startsOn,
          status: "active",
        },
        select: {
          id: true,
          academicYearId: true,
          yearGroupId: true,
          formId: true,
          houseId: true,
          startsOn: true,
          academicYear: { select: { code: true } },
          yearGroup: { select: { code: true, name: true } },
          form: { select: { code: true } },
          house: { select: { code: true, name: true } },
        },
      });
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "pupil.enrolment.placement_changed",
          entityType: "pupil_enrolment",
          entityId: next.id,
          metadata: {
            pupilId,
            previousEnrolmentId: current.id,
            previous: {
              academicYearId: current.academicYearId,
              yearGroupId: current.yearGroupId,
              formId: current.formId,
              houseId: current.houseId,
            },
            current: {
              academicYearId: next.academicYearId,
              yearGroupId: next.yearGroupId,
              formId: next.formId,
              houseId: next.houseId,
              startsOn: input.startsOn,
            },
          },
        },
      });

      return { pupilId, previousEnrolmentId: current.id, enrolment: next };
    });
  }

  async grantMembershipRole(
    schoolId: string,
    actorUserId: string,
    membershipId: string,
    roleCode: string,
  ): Promise<{ membershipId: string; roleCode: string; granted: boolean }> {
    await this.requireSchoolRole(schoolId, actorUserId, ["SUPER_ADMIN"]);

    const membership = await this.prisma.schoolMembership.findFirst({
      where: { id: membershipId, schoolId, status: "active" },
      select: { id: true },
    });
    if (!membership) {
      throw new NotFoundException("Active school membership not found.");
    }

    const role = await this.prisma.role.findUnique({
      where: { schoolId_code: { schoolId, code: roleCode } },
      select: { id: true },
    });
    if (!role) {
      throw new NotFoundException("Role not found in this school.");
    }

    const granted = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.membershipRole.createMany({
        data: [{ schoolId, membershipId, roleId: role.id }],
        skipDuplicates: true,
      });
      if (result.count === 0) return false;

      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "school.membership_role.granted",
          entityType: "school_membership",
          entityId: membershipId,
          metadata: { roleCode },
        },
      });
      return true;
    });

    return { membershipId, roleCode, granted };
  }

  async listSchoolMembers(
    schoolId: string,
    actorUserId: string,
  ): Promise<{
    total: number;
    items: Array<{
      id: string;
      userId: string;
      email: string;
      status: string;
      roles: Array<{ code: string; name: string }>;
    }>;
  }> {
    await this.requireSchoolRole(schoolId, actorUserId, ["SUPER_ADMIN"]);
    const memberships = await this.prisma.schoolMembership.findMany({
      where: { schoolId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        status: true,
        user: { select: { emailNormalized: true } },
        membershipRoles: {
          select: { role: { select: { code: true, name: true } } },
        },
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId,
        action: "school.members.viewed",
        entityType: "school_membership",
        metadata: { resultCount: memberships.length },
      },
    });

    return {
      total: memberships.length,
      items: memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        email: membership.user.emailNormalized,
        status: membership.status,
        roles: membership.membershipRoles.map(({ role }) => ({
          code: role.code,
          name: role.name,
        })),
      })),
    };
  }

  async listSchoolRolePermissions(schoolId: string, actorUserId: string) {
    await this.requireSchoolRole(schoolId, actorUserId, ["SUPER_ADMIN"]);

    const [roles, permissions] = await Promise.all([
      this.prisma.role.findMany({
        where: {
          schoolId,
          code: { notIn: ["SUPER_ADMIN", "PARENT", "STUDENT"] },
        },
        orderBy: { name: "asc" },
        select: {
          code: true,
          name: true,
          rolePermissions: {
            where: { schoolId },
            select: { permissionCode: true },
          },
        },
      }),
      this.prisma.permission.findMany({
        where: { code: { not: "school.roles.manage" } },
        orderBy: { code: "asc" },
        select: { code: true, description: true },
      }),
    ]);

    await this.prisma.auditEvent.create({
      data: {
        schoolId,
        actorUserId,
        action: "school.role_permissions.viewed",
        entityType: "school_role",
        metadata: { roleCount: roles.length, permissionCount: permissions.length },
      },
    });

    return {
      roles: roles.map(({ code, name, rolePermissions }) => ({
        code,
        name,
        permissionCodes: rolePermissions.map(({ permissionCode }) => permissionCode),
      })),
      permissions,
    };
  }

  async updateSchoolRolePermissions(
    schoolId: string,
    actorUserId: string,
    roleCode: string,
    permissionCodes: string[],
  ) {
    await this.requireSchoolRole(schoolId, actorUserId, ["SUPER_ADMIN"]);

    if (new Set(permissionCodes).size !== permissionCodes.length) {
      throw new BadRequestException("A permission can only be selected once.");
    }

    const role = await this.prisma.role.findUnique({
      where: { schoolId_code: { schoolId, code: roleCode } },
      select: { id: true, code: true, name: true },
    });
    if (!role || ["SUPER_ADMIN", "PARENT", "STUDENT"].includes(role.code)) {
      throw new NotFoundException("Configurable staff role not found.");
    }

    const availablePermissions = await this.prisma.permission.findMany({
      where: {
        code: {
          in: permissionCodes,
          not: "school.roles.manage",
        },
      },
      select: { code: true },
    });
    if (availablePermissions.length !== permissionCodes.length) {
      throw new BadRequestException("Choose permissions from the available list.");
    }

    const currentPermissions = await this.prisma.rolePermission.findMany({
      where: { schoolId, roleId: role.id },
      select: { permissionCode: true },
    });
    const currentCodes = currentPermissions.map(({ permissionCode }) => permissionCode);
    const grantedCodes = permissionCodes.filter((code) => !currentCodes.includes(code));
    const removedCodes = currentCodes.filter((code) => !permissionCodes.includes(code));
    const nextCodes = [...permissionCodes].sort();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.rolePermission.deleteMany({ where: { schoolId, roleId: role.id } });
      if (nextCodes.length > 0) {
        await transaction.rolePermission.createMany({
          data: nextCodes.map((permissionCode) => ({
            schoolId,
            roleId: role.id,
            permissionCode,
          })),
        });
      }
      await transaction.auditEvent.create({
        data: {
          schoolId,
          actorUserId,
          action: "school.role_permissions.updated",
          entityType: "school_role",
          entityId: role.id,
          metadata: {
            roleCode: role.code,
            granted: grantedCodes,
            removed: removedCodes,
          },
        },
      });
    });

    return { role: { code: role.code, name: role.name }, permissionCodes: nextCodes };
  }

  private async requireSchoolRole(schoolId: string, userId: string, allowedRoles: string[]) {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        schoolId,
        userId,
        status: "active",
        membershipRoles: { some: { role: { code: { in: allowedRoles } } } },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException("This operation is not permitted for your school role.");
    }
  }
}
