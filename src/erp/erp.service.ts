import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

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

  async getStudentSummary(userId: string, schoolId: string) {
    const person = await this.prisma.person.findFirst({
      where: { schoolId, userId },
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

    const contacts = await this.prisma.pupilContact.findMany({
      where: {
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

  async listPupils(schoolId: string) {
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

  async getAcademicStructure(schoolId: string) {
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
}
