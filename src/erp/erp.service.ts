import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const SCHOOL_STRUCTURE_ROLES = [
  "SUPER_ADMIN", "HEADTEACHER", "SLT", "ADMIN", "TEACHER", "DSL", "DEPUTY_DSL",
  "SAFEGUARDING", "SENCO", "DEPUTY_SENCO", "FINANCE", "MEDICAL", "ATTENDANCE_OFFICER",
  "ADMISSIONS_OFFICER", "EXAMS_OFFICER", "SUPPORT_STAFF", "STUDENT",
];
const PUPIL_DIRECTORY_ROLES = ["SUPER_ADMIN", "HEADTEACHER", "SLT", "ADMIN"];
const PUPIL_SUMMARY_ROLES = [
  "SUPER_ADMIN", "HEADTEACHER", "SLT", "ADMIN", "DSL", "DEPUTY_DSL", "SENCO", "DEPUTY_SENCO",
  "MEDICAL", "ATTENDANCE_OFFICER", "ADMISSIONS_OFFICER", "EXAMS_OFFICER", "SUPPORT_STAFF",
];

@Injectable()
export class ErpService {
  constructor(private readonly prisma: PrismaService) {}

  private buildPersonName(person: { legalFirstName: string; preferredName?: string | null; lastName: string }) {
    return `${person.preferredName || person.legalFirstName} ${person.lastName}`.trim();
  }

  private summarizeAttendance(records: Array<{ code?: { countsAsPresent: boolean } | null }>) {
    const totalMarks = records.length;
    const presentMarks = records.filter((record) => record.code?.countsAsPresent).length;
    const attendanceRate = totalMarks > 0 ? (presentMarks / totalMarks) * 100 : 0;

    return {
      totalMarks,
      presentMarks,
      attendanceRate,
    };
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
            admissionNumber: true,
            status: true,
            enrolments: {
              where: { status: "active" },
              orderBy: { startsOn: "desc" },
              take: 1,
              select: {
                yearGroup: { select: { code: true, name: true } },
                form: { select: { code: true } },
              },
            },
            attendanceRecords: {
              select: {
                attendanceCode: true,
                code: { select: { countsAsPresent: true } },
              },
            },
          },
        },
      },
    });

    if (!person?.pupilProfile) {
      return null;
    }

    const attendance = this.summarizeAttendance(person.pupilProfile.attendanceRecords);
    const activeEnrolment = person.pupilProfile.enrolments[0];

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
              where: { status: "active" },
              orderBy: { startsOn: "desc" },
              take: 1,
              select: {
                yearGroup: { select: { code: true, name: true } },
                form: { select: { code: true } },
              },
            },
            attendanceRecords: {
              select: {
                attendanceCode: true,
                code: { select: { countsAsPresent: true } },
              },
            },
          },
        },
      },
    });

    return contacts.map((contact) => {
      const activeEnrolment = contact.pupil.enrolments[0];
      const attendance = this.summarizeAttendance(contact.pupil.attendanceRecords);

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
      };
    });
  }

  async listPupils(schoolId: string, userId: string) {
    await this.requireSchoolRole(schoolId, userId, PUPIL_DIRECTORY_ROLES);
    const rows = await this.prisma.person.findMany({
      where: {
        schoolId,
        pupilProfile: {
          isNot: null,
        },
      },
      select: {
        id: true,
        legalFirstName: true,
        lastName: true,
        pupilProfile: {
          select: {
            id: true,
            admissionNumber: true,
            status: true,
          },
        },
      },
    });

    const items = rows.map((person) => ({
      personId: person.id,
      pupilId: person.pupilProfile?.id,
      admissionNumber: person.pupilProfile?.admissionNumber,
      status: person.pupilProfile?.status,
      name: `${person.legalFirstName} ${person.lastName}`.trim(),
    }));

    return {
      total: items.length,
      items,
    };
  }

  async getPupilCount(schoolId: string, userId: string) {
    await this.requireSchoolRole(schoolId, userId, PUPIL_SUMMARY_ROLES);
    return { total: await this.prisma.pupilProfile.count({ where: { schoolId } }) };
  }

  async getAcademicStructure(schoolId: string, userId: string) {
    await this.requireSchoolRole(schoolId, userId, SCHOOL_STRUCTURE_ROLES);
    const [currentAcademicYear, yearGroups, forms, houses, subjects] = await Promise.all([
      this.prisma.academicYear.findFirst({
        where: { schoolId, isCurrent: true },
        orderBy: { startsOn: "desc" },
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
