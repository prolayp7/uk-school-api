import { createHash, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SCHOOL_CODE = "WESTBRIDGE-ACADEMY";
const SCHOOL_NAME = "Westbridge Academy";
const SUPER_ADMIN_EMAIL = "superadmin@example.test";
const SEED_SALT = "uk-school-erp-development-seed-20260930";
const DEVELOPMENT_PASSWORD = "ChangeMe123!";
const ACADEMIC_YEAR = "2026/2027";
const SEED_DATE = new Date("2026-09-30T12:00:00.000Z");

const firstNames = [
  "Aisha", "Amelia", "Arthur", "Ben", "Chloe", "Daniel", "Daisy", "Elliot",
  "Ellie", "Freddie", "Grace", "Hannah", "Harvey", "Imogen", "Isaac", "Jack",
  "Laila", "Leo", "Lily", "Maisie", "Mason", "Maya", "Noah", "Olivia", "Oscar",
  "Poppy", "Ravi", "Ruby", "Sofia", "Theo", "William", "Zara",
];

const lastNames = [
  "Abbott", "Ahmed", "Bennett", "Brooks", "Campbell", "Clarke", "Davies", "Edwards",
  "Foster", "Green", "Hall", "Hughes", "Iqbal", "James", "Khan", "Lewis", "Morgan",
  "Patel", "Reed", "Shah", "Taylor", "Turner", "Walker", "Williams", "Wright",
];

const yearGroupSpecs = [
  { code: "7", name: "Year 7", keyStage: "KS3", sortOrder: 7, count: 50 },
  { code: "8", name: "Year 8", keyStage: "KS3", sortOrder: 8, count: 50 },
  { code: "9", name: "Year 9", keyStage: "KS3", sortOrder: 9, count: 45 },
  { code: "10", name: "Year 10", keyStage: "KS4", sortOrder: 10, count: 45 },
  { code: "11", name: "Year 11", keyStage: "KS4", sortOrder: 11, count: 45 },
  { code: "12", name: "Year 12", keyStage: "KS5", sortOrder: 12, count: 35 },
  { code: "13", name: "Year 13", keyStage: "KS5", sortOrder: 13, count: 30 },
];

const departmentSpecs = [
  ["ENGLISH", "English"],
  ["MATHS", "Mathematics"],
  ["SCIENCE", "Science"],
  ["COMPUTING", "Computing"],
  ["HISTORY", "History"],
  ["GEOGRAPHY", "Geography"],
  ["MFL", "Modern Foreign Languages"],
  ["ART", "Art"],
  ["DESIGN", "Design & Technology"],
  ["MUSIC", "Music"],
  ["DRAMA", "Drama"],
  ["PE", "Physical Education"],
  ["RE", "Religious Education"],
  ["PSHE", "PSHE"],
  ["SEN", "SEN / Inclusion"],
  ["PASTORAL", "Pastoral"],
  ["SAFEGUARD", "Safeguarding"],
  ["ADMISSIONS", "Admissions"],
  ["FINANCE", "Finance"],
  ["ADMIN", "Administration"],
  ["EXAMS", "Examinations"],
] as const;

const subjectSpecs = [
  ["ENG", "English", "ENGLISH"],
  ["MAT", "Mathematics", "MATHS"],
  ["BIO", "Biology", "SCIENCE"],
  ["CHEM", "Chemistry", "SCIENCE"],
  ["PHYS", "Physics", "SCIENCE"],
  ["COMSCI", "Computer Science", "COMPUTING"],
  ["ICT", "ICT", "COMPUTING"],
  ["HIST", "History", "HISTORY"],
  ["GEO", "Geography", "GEOGRAPHY"],
  ["FRE", "French", "MFL"],
  ["SPA", "Spanish", "MFL"],
  ["ART", "Art", "ART"],
  ["DT", "Design Technology", "DESIGN"],
  ["FOOD", "Food Technology", "DESIGN"],
  ["MUS", "Music", "MUSIC"],
  ["DRA", "Drama", "DRAMA"],
  ["PE", "Physical Education", "PE"],
  ["RE", "Religious Education", "RE"],
  ["PSHE", "PSHE", "PSHE"],
  ["BUS", "Business Studies", "MATHS"],
  ["ECON", "Economics", "MATHS"],
  ["SOC", "Sociology", "HISTORY"],
  ["PSY", "Psychology", "SCIENCE"],
] as const;

const roleSpecs = [
  ["SUPER_ADMIN", "Super administrator"],
  ["HEADTEACHER", "Headteacher"],
  ["SLT", "Senior leadership team"],
  ["ADMIN", "Administrator"],
  ["TEACHER", "Teacher"],
  ["DSL", "Designated safeguarding lead"],
  ["DEPUTY_DSL", "Deputy designated safeguarding lead"],
  ["SAFEGUARDING", "Safeguarding officer"],
  ["SENCO", "SENCO"],
  ["DEPUTY_SENCO", "Deputy SENCO"],
  ["FINANCE", "Finance staff"],
  ["MEDICAL", "Medical staff"],
  ["ATTENDANCE_OFFICER", "Attendance officer"],
  ["ADMISSIONS_OFFICER", "Admissions officer"],
  ["EXAMS_OFFICER", "Examinations officer"],
  ["SUPPORT_STAFF", "Support staff"],
  ["PARENT", "Parent or carer"],
  ["STUDENT", "Student"],
] as const;

const permissionSpecs = [
  ["school.read", "Read school profile"],
  ["school.members.read", "Read school memberships"],
  ["school.members.manage", "Create and update school memberships"],
  ["school.roles.manage", "Manage school role assignments"],
  ["audit.read", "Read authorized audit events"],
] as const;

const staffSpecs = createStaffSpecs();

function createStaffSpecs() {
  const teacherDepartmentCodes = [
    ...Array(4).fill("ENGLISH"),
    ...Array(5).fill("MATHS"),
    ...Array(5).fill("SCIENCE"),
    ...Array(2).fill("COMPUTING"),
    ...Array(2).fill("HISTORY"),
    ...Array(2).fill("GEOGRAPHY"),
    ...Array(2).fill("MFL"),
    "ART", "DESIGN", "MUSIC", "DRAMA",
    ...Array(2).fill("PE"),
    "RE", "PSHE",
  ];
  const teachers = teacherDepartmentCodes.map((departmentCode, index) => ({
    key: `TCH${String(index + 1).padStart(4, "0")}`,
    email: `teacher${String(index + 1).padStart(2, "0")}@example.test`,
    departmentCode,
    staffType: "teacher",
    jobTitle: index % 8 === 0 ? "Head of Department" : index % 7 === 0 ? "Form Tutor" : "Teacher",
    roleCode: "TEACHER",
    nameIndex: index,
  }));
  const otherStaff = [
    ["headteacher", "Headteacher", "ADMIN", "leadership", "HEADTEACHER"],
    ["deputy-headteacher", "Deputy Headteacher", "ADMIN", "leadership", "SLT"],
    ["assistant-headteacher-1", "Assistant Headteacher", "ADMIN", "leadership", "SLT"],
    ["assistant-headteacher-2", "Assistant Headteacher", "ADMIN", "leadership", "SLT"],
    ["business-manager", "Business Manager", "FINANCE", "leadership", "ADMIN"],
    ["dsl", "Designated Safeguarding Lead", "SAFEGUARD", "safeguarding", "DSL"],
    ["deputy-dsl", "Deputy DSL", "SAFEGUARD", "safeguarding", "DEPUTY_DSL"],
    ["safeguarding-officer", "Safeguarding Officer", "SAFEGUARD", "safeguarding", "SAFEGUARDING"],
    ["senco", "SENCO", "SEN", "send", "SENCO"],
    ["deputy-senco", "Deputy SENCO / Inclusion Lead", "SEN", "send", "DEPUTY_SENCO"],
    ["school-nurse", "School Nurse", "PASTORAL", "medical", "MEDICAL"],
    ["first-aid-officer", "First Aid / Medical Officer", "PASTORAL", "medical", "MEDICAL"],
    ["finance-manager", "Finance Manager", "FINANCE", "finance", "FINANCE"],
    ["finance-officer", "Finance Officer", "FINANCE", "finance", "FINANCE"],
    ["finance-assistant", "Finance Assistant", "FINANCE", "finance", "FINANCE"],
    ["office-manager", "Office Manager", "ADMIN", "administration", "ADMIN"],
    ["school-administrator", "School Administrator", "ADMIN", "administration", "ADMIN"],
    ["admissions-officer", "Admissions Officer", "ADMISSIONS", "administration", "ADMISSIONS_OFFICER"],
    ["attendance-officer", "Attendance Officer", "ADMIN", "administration", "ATTENDANCE_OFFICER"],
    ["receptionist", "Receptionist", "ADMIN", "administration", "ADMIN"],
    ["data-administrator", "Data Administrator", "ADMIN", "administration", "ADMIN"],
    ["exams-officer", "Exams Officer", "EXAMS", "administration", "EXAMS_OFFICER"],
    ["hr-administrator", "HR / Admin Officer", "ADMIN", "administration", "ADMIN"],
    ["teaching-assistant", "Teaching Assistant", "SEN", "support", "SUPPORT_STAFF"],
    ["learning-support-assistant", "Learning Support Assistant", "SEN", "support", "SUPPORT_STAFF"],
    ["cover-supervisor", "Cover Supervisor", "PASTORAL", "support", "SUPPORT_STAFF"],
    ["pastoral-support", "Pastoral Support Officer", "PASTORAL", "support", "SUPPORT_STAFF"],
    ["ict-technician", "ICT Technician", "COMPUTING", "support", "SUPPORT_STAFF"],
    ["librarian", "Librarian", "ADMIN", "support", "SUPPORT_STAFF"],
    ["facilities-officer", "Facilities Officer", "ADMIN", "support", "SUPPORT_STAFF"],
    ["caretaker", "Caretaker", "ADMIN", "support", "SUPPORT_STAFF"],
    ["catering-staff", "Catering Staff", "ADMIN", "support", "SUPPORT_STAFF"],
    ["activities-coordinator", "Activities Coordinator", "PASTORAL", "support", "SUPPORT_STAFF"],
      ["superadmin", "System Super Administrator", "ADMIN", "leadership", "SUPER_ADMIN"],
  ].map(([key, jobTitle, departmentCode, staffType, roleCode], index) => ({
    key: `STF${String(index + 1).padStart(4, "0")}`,
    email: `${key}@example.test`,
    departmentCode,
    staffType,
    jobTitle,
    roleCode,
    nameIndex: teachers.length + index,
  }));
  return [...teachers, ...otherStaff];
}

function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function stableNumber(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

function studentNumber(index: number): string {
  return `STU${String(index + 1).padStart(4, "0")}`;
}

function parentNumber(index: number): string {
  return `PAR${String(index + 1).padStart(4, "0")}`;
}

function studentName(index: number) {
  return {
    first: firstNames[(index * 7 + Math.floor(index / firstNames.length)) % firstNames.length],
    last: lastNames[(index * 11 + Math.floor(index / lastNames.length)) % lastNames.length],
  };
}

function parentIndexForStudent(index: number): number {
  if (index < 160) return index;
  if (index < 240) return 160 + Math.floor((index - 160) / 2);
  return 200 + Math.floor((index - 240) / 3);
}

function studentIndexForParent(index: number): number {
  if (index < 160) return index;
  if (index < 200) return 160 + (index - 160) * 2;
  if (index < 220) return 240 + (index - 200) * 3;
  return index - 220;
}

function makePasswordHash(): string {
  const derived = scryptSync(DEVELOPMENT_PASSWORD, SEED_SALT, 64).toString("hex");
  return `scrypt$${SEED_SALT}$${derived}`;
}

async function insertBatches<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
  batchSize = 500,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await insert(rows.slice(offset, offset + batchSize));
  }
}

async function requireLocalDevelopmentDatabase(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed cannot run in production.");
  }
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL must be configured before seeding.");
  const databaseUrl = new URL(rawUrl);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(databaseUrl.hostname)) {
    throw new Error("Development seed is restricted to a local PostgreSQL database.");
  }
}

async function createAcademicStructure(schoolId: string) {
  const academicYear = await prisma.academicYear.upsert({
    where: { schoolId_code: { schoolId, code: ACADEMIC_YEAR } },
    create: {
      schoolId,
      code: ACADEMIC_YEAR,
      startsOn: dateOnly(2026, 9, 1),
      endsOn: dateOnly(2027, 8, 31),
      isCurrent: true,
    },
    update: {
      startsOn: dateOnly(2026, 9, 1),
      endsOn: dateOnly(2027, 8, 31),
      isCurrent: true,
    },
  });
  const terms = [
    { code: "AUTUMN", startsOn: dateOnly(2026, 9, 1), endsOn: dateOnly(2026, 12, 18) },
    { code: "SPRING", startsOn: dateOnly(2027, 1, 4), endsOn: dateOnly(2027, 4, 1) },
    { code: "SUMMER", startsOn: dateOnly(2027, 4, 19), endsOn: dateOnly(2027, 7, 23) },
  ];
  await insertBatches(terms.map((term) => ({ schoolId, academicYearId: academicYear.id, ...term })),
    (batch) => prisma.term.createMany({ data: batch, skipDuplicates: true }));

  await insertBatches(yearGroupSpecs.map(({ code, name, keyStage, sortOrder }) => ({ schoolId, code, name, keyStage, sortOrder })),
    (batch) => prisma.yearGroup.createMany({ data: batch, skipDuplicates: true }));
  const yearGroups = await prisma.yearGroup.findMany({ where: { schoolId } });
  const yearGroupByCode = new Map(yearGroups.map((group) => [group.code, group]));

  const formSpecs = yearGroupSpecs.flatMap((group) => {
    const formCount = group.sortOrder <= 11 ? 3 : 2;
    return Array.from({ length: formCount }, (_, index) => ({
      schoolId,
      yearGroupId: yearGroupByCode.get(group.code)!.id,
      code: `${group.code}${String.fromCharCode(65 + index)}`,
    }));
  });
  await insertBatches(formSpecs, (batch) => prisma.form.createMany({ data: batch, skipDuplicates: true }));

  await insertBatches(
    ["Ash", "Oak", "Rowan", "Willow"].map((name) => ({
      schoolId,
      code: name.toUpperCase(),
      name,
    })),
    (batch) => prisma.house.createMany({ data: batch, skipDuplicates: true }),
  );

  await insertBatches(
    departmentSpecs.map(([code, name]) => ({ schoolId, code, name })),
    (batch) => prisma.department.createMany({ data: batch, skipDuplicates: true }),
  );
  const departments = await prisma.department.findMany({ where: { schoolId } });
  const departmentByCode = new Map(departments.map((department) => [department.code, department]));
  await insertBatches(
    subjectSpecs.map(([code, name, departmentCode]) => ({
      schoolId,
      code,
      name,
      departmentId: departmentByCode.get(departmentCode)?.id,
    })),
    (batch) => prisma.subject.createMany({ data: batch, skipDuplicates: true }),
  );
  return { academicYear, yearGroupByCode, departmentByCode };
}

async function createRolesAndUsers(schoolId: string) {
  for (const [code, description] of permissionSpecs) {
    await prisma.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
  }
  await insertBatches(
    roleSpecs.map(([code, name]) => ({ schoolId, code, name })),
    (batch) => prisma.role.createMany({ data: batch, skipDuplicates: true }),
  );
  const roles = await prisma.role.findMany({ where: { schoolId } });
  const roleByCode = new Map(roles.map((role) => [role.code, role]));

  const permissionCodesByRole: Record<string, string[]> = {
    SUPER_ADMIN: permissionSpecs.map(([code]) => code),
    HEADTEACHER: permissionSpecs.map(([code]) => code),
    SLT: ["school.read", "school.members.read", "audit.read"],
    ADMIN: ["school.read", "school.members.read", "school.members.manage"],
    DSL: ["school.read"],
    DEPUTY_DSL: ["school.read"],
  };
  const rolePermissions = Object.entries(permissionCodesByRole).flatMap(([roleCode, codes]) =>
    codes.map((permissionCode) => ({ schoolId, roleId: roleByCode.get(roleCode)!.id, permissionCode })),
  );
  await insertBatches(rolePermissions,
    (batch) => prisma.rolePermission.createMany({ data: batch, skipDuplicates: true }));

  const passwordHash = makePasswordHash();
  const users = [
    ...staffSpecs.map((staff) => ({ emailNormalized: staff.email, passwordHash, roleCode: staff.roleCode })),
    ...Array.from({ length: 300 }, (_, index) => ({
      emailNormalized: `student${String(index + 1).padStart(3, "0")}@example.test`,
      passwordHash,
      roleCode: "STUDENT",
    })),
    ...Array.from({ length: 230 }, (_, index) => ({
      emailNormalized: `parent${String(index + 1).padStart(3, "0")}@example.test`,
      passwordHash,
      roleCode: "PARENT",
    })),
  ];
  await insertBatches(users.map(({ emailNormalized, passwordHash }) => ({ emailNormalized, passwordHash, status: "active" })),
    (batch) => prisma.user.createMany({ data: batch, skipDuplicates: true }));

  const persistedUsers = await prisma.user.findMany({
    where: { emailNormalized: { endsWith: "@example.test" } },
    select: { id: true, emailNormalized: true },
  });
  const userByEmail = new Map(persistedUsers.map((user) => [user.emailNormalized, user]));
  const memberships = users.map((user) => ({
    schoolId,
    userId: userByEmail.get(user.emailNormalized)!.id,
    roleId: roleByCode.get(user.roleCode)!.id,
  }));
  await insertBatches(memberships.map(({ schoolId: id, userId }) => ({ schoolId: id, userId, status: "active" })),
    (batch) => prisma.schoolMembership.createMany({ data: batch, skipDuplicates: true }));

  const persistedMemberships = await prisma.schoolMembership.findMany({
    where: { schoolId },
    select: { id: true, userId: true },
  });
  const membershipIdByUserId = new Map(persistedMemberships.map((membership) => [membership.userId, membership.id]));
  const membershipRoles = memberships.map((membership) => ({
    schoolId,
    membershipId: membershipIdByUserId.get(membership.userId)!,
    roleId: membership.roleId,
  }));
  await insertBatches(membershipRoles,
    (batch) => prisma.membershipRole.createMany({ data: batch, skipDuplicates: true }));

  return { userByEmail };
}

async function createPeopleAndProfiles(schoolId: string, academicYearId: string, departmentByCode: Map<string, { id: string }>, userByEmail: Map<string, { id: string }>) {
  const staffPeople = staffSpecs.map((staff, index) => {
    const name = studentName(staff.nameIndex + 400);
    return {
      schoolId,
      userId: userByEmail.get(staff.email)!.id,
      legalFirstName: name.first,
      lastName: name.last,
      seedKey: `staff:${staff.key}`,
      addressLine1: `${10 + index} Meadow Lane`,
      town: "Westbridge",
      postcode: `WB${(index % 9) + 1} ${(index % 9) + 1}AB`,
      phoneNumber: `01632 960${String(index).padStart(3, "0")}`,
    };
  });
  const pupilPeople = Array.from({ length: 300 }, (_, index) => {
    const name = studentName(index);
    const yearGroupIndex = yearGroupSpecs.findIndex((group, groupIndex) =>
      index < yearGroupSpecs.slice(0, groupIndex + 1).reduce((total, item) => total + item.count, 0));
    const month = (index * 7) % 12 + 1;
    const year = 2014 - yearGroupIndex + (month < 9 ? 1 : 0);
    return {
      schoolId,
      userId: userByEmail.get(`student${String(index + 1).padStart(3, "0")}@example.test`)!.id,
      legalFirstName: name.first,
      lastName: name.last,
      dateOfBirth: dateOnly(year, month, (index * 11) % 28 + 1),
      seedKey: `student:${studentNumber(index)}`,
      addressLine1: `${1 + (index % 90)} Kingsbridge Road`,
      town: "Westbridge",
      postcode: `WB${(index % 9) + 1} ${(index % 9) + 1}AB`,
      phoneNumber: `01632 961${String(index).padStart(3, "0")}`,
    };
  });
  const parentPeople = Array.from({ length: 230 }, (_, index) => {
    const name = studentName(index + 900);
    const familyName = studentName(studentIndexForParent(index));
    return {
      schoolId,
      userId: userByEmail.get(`parent${String(index + 1).padStart(3, "0")}@example.test`)!.id,
      legalFirstName: name.first,
      lastName: familyName.last,
      seedKey: `parent:${parentNumber(index)}`,
      addressLine1: `${20 + (index % 70)} Kingsbridge Road`,
      town: "Westbridge",
      postcode: `WB${(index % 9) + 1} ${(index % 9) + 1}AB`,
      phoneNumber: `01632 962${String(index).padStart(3, "0")}`,
    };
  });
  const allPeople = [...staffPeople, ...pupilPeople, ...parentPeople];
  await insertBatches(allPeople, (batch) => prisma.person.createMany({ data: batch, skipDuplicates: true }));
  const people = await prisma.person.findMany({ where: { schoolId }, select: { id: true, seedKey: true } });
  const personIdBySeedKey = new Map(people.map((person) => [person.seedKey!, person.id]));

  await insertBatches(
    staffSpecs.map((staff, index) => ({
      schoolId,
      personId: personIdBySeedKey.get(`staff:${staff.key}`)!,
      departmentId: departmentByCode.get(staff.departmentCode)?.id,
      staffNumber: staff.key,
      staffType: staff.staffType,
      jobTitle: staff.jobTitle,
      email: staff.email,
      startDate: dateOnly(2015 + (index % 10), 9, 1),
    })),
    (batch) => prisma.staffProfile.createMany({ data: batch, skipDuplicates: true }),
  );
  const staffProfiles = await prisma.staffProfile.findMany({ where: { schoolId }, select: { id: true, staffNumber: true } });
  const staffIdByNumber = new Map(staffProfiles.map((staff) => [staff.staffNumber, staff.id]));
  const tutorForms = await prisma.form.findMany({
    where: { schoolId },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  await Promise.all(tutorForms.map((form, index) => prisma.form.update({
    where: { id: form.id },
    data: { tutorStaffId: staffIdByNumber.get(`TCH${String(index % 30 + 1).padStart(4, "0")}`)! },
  })));

  await insertBatches(
    parentPeople.map((person, index) => ({
      schoolId,
      personId: personIdBySeedKey.get(`parent:${parentNumber(index)}`)!,
      email: `parent${String(index + 1).padStart(3, "0")}@example.test`,
      phone: person.phoneNumber!,
    })),
    (batch) => prisma.parentCarerProfile.createMany({ data: batch, skipDuplicates: true }),
  );

  const pupilSpecs = Array.from({ length: 300 }, (_, index) => {
    const groupIndex = yearGroupSpecs.findIndex((group, currentIndex) =>
      index < yearGroupSpecs.slice(0, currentIndex + 1).reduce((total, item) => total + item.count, 0));
    const group = yearGroupSpecs[groupIndex];
    const groupOffset = index - yearGroupSpecs.slice(0, groupIndex).reduce((total, item) => total + item.count, 0);
    const formCount = groupIndex <= 4 ? 3 : 2;
    return {
      index,
      yearGroupCode: group.code,
      formCode: `${group.code}${String.fromCharCode(65 + (groupOffset % formCount))}`,
      houseCode: ["ASH", "OAK", "ROWAN", "WILLOW"][index % 4],
    };
  });
  await insertBatches(
    pupilSpecs.map((pupil) => ({
      schoolId,
      personId: personIdBySeedKey.get(`student:${studentNumber(pupil.index)}`)!,
      upn: `WB${String(pupil.index + 1).padStart(11, "0")}`,
      admissionNumber: `ADM${String(pupil.index + 1).padStart(4, "0")}`,
      gender: ["female", "male", "not_recorded"][pupil.index % 3],
      admissionDate: dateOnly(2020 + (pupil.index % 7), 9, 1),
      status: "enrolled",
    })),
    (batch) => prisma.pupilProfile.createMany({ data: batch, skipDuplicates: true }),
  );
  const pupils = await prisma.pupilProfile.findMany({
    where: { schoolId },
    orderBy: { admissionNumber: "asc" },
    select: { id: true, admissionNumber: true },
  });
  const pupilByAdmissionNumber = new Map(pupils.map((pupil) => [pupil.admissionNumber, pupil]));

  const yearGroups = await prisma.yearGroup.findMany({ where: { schoolId }, select: { id: true, code: true } });
  const yearGroupIdByCode = new Map(yearGroups.map((group) => [group.code, group.id]));
  const forms = await prisma.form.findMany({ where: { schoolId }, select: { id: true, code: true } });
  const formByCode = new Map(forms.map((form) => [form.code, form]));
  const houses = await prisma.house.findMany({ where: { schoolId }, select: { id: true, code: true } });
  const houseIdByCode = new Map(houses.map((house) => [house.code, house.id]));

  await insertBatches(
    pupilSpecs.map((pupil) => ({
      schoolId,
      pupilId: pupilByAdmissionNumber.get(`ADM${String(pupil.index + 1).padStart(4, "0")}`)!.id,
      academicYearId,
      yearGroupId: yearGroupIdByCode.get(pupil.yearGroupCode)!,
      formId: formByCode.get(pupil.formCode)!.id,
      houseId: houseIdByCode.get(pupil.houseCode)!,
      startsOn: dateOnly(2026, 9, 1),
      status: "active",
    })),
    (batch) => prisma.pupilEnrolment.createMany({ data: batch, skipDuplicates: true }),
  );

  const contacts = pupilSpecs.flatMap((pupil) => {
    const primaryIndex = parentIndexForStudent(pupil.index);
    const primaryContact = {
      schoolId,
      pupilId: pupilByAdmissionNumber.get(`ADM${String(pupil.index + 1).padStart(4, "0")}`)!.id,
      guardianPersonId: personIdBySeedKey.get(`parent:${parentNumber(primaryIndex)}`)!,
      relationship: ["Mother", "Father", "Guardian"][pupil.index % 3],
      isPrimary: true,
      canCollect: true,
      hasParentalResponsibility: true,
      canViewPortal: true,
    };
    const secondaryIndex = pupil.index < 10 ? 220 + pupil.index : undefined;
    const secondaryContact = secondaryIndex === undefined ? [] : [{
      ...primaryContact,
      guardianPersonId: personIdBySeedKey.get(`parent:${parentNumber(secondaryIndex)}`)!,
      relationship: "Carer",
      isPrimary: false,
      hasParentalResponsibility: false,
    }];
    return [primaryContact, ...secondaryContact];
  });
  await insertBatches(contacts, (batch) => prisma.pupilContact.createMany({ data: batch, skipDuplicates: true }));

  return { staffIdByNumber, pupils };
}

async function createClasses(schoolId: string, academicYearId: string, yearGroupIdByCode: Map<string, string>) {
  const subjects = await prisma.subject.findMany({ where: { schoolId }, select: { id: true, code: true } });
  const subjectIdByCode = new Map(subjects.map((subject) => [subject.code, subject.id]));
  const departments = await prisma.department.findMany({ where: { schoolId }, select: { id: true, code: true } });
  const departmentById = new Map(departments.map((department) => [department.id, department.code]));
  const teachers = await prisma.staffProfile.findMany({
    where: { schoolId, staffType: "teacher" },
    orderBy: { staffNumber: "asc" },
    select: { id: true, departmentId: true },
  });
  const teachersByDepartment = new Map<string, typeof teachers>();
  for (const teacher of teachers) {
    const departmentCode = departmentById.get(teacher.departmentId ?? "");
    if (departmentCode) teachersByDepartment.set(departmentCode, [...(teachersByDepartment.get(departmentCode) ?? []), teacher]);
  }

  const classSpecs = yearGroupSpecs.flatMap((group) => subjectSpecs.map(([subjectCode, , departmentCode], index) => {
    const teacherPool = teachersByDepartment.get(departmentCode) ?? teachers;
    const teacher = teacherPool[(group.sortOrder + index) % teacherPool.length];
    return {
      schoolId,
      academicYearId,
      yearGroupId: yearGroupIdByCode.get(group.code)!,
      subjectId: subjectIdByCode.get(subjectCode)!,
      teacherStaffId: teacher.id,
      code: `${group.code}-${subjectCode}`,
    };
  }));
  await insertBatches(classSpecs, (batch) => prisma.classGroup.createMany({ data: batch, skipDuplicates: true }));

  const classGroups = await prisma.classGroup.findMany({ where: { schoolId }, select: { id: true, yearGroupId: true } });
  const yearGroupCodeById = new Map([...yearGroupIdByCode].map(([code, id]) => [id, code]));
  const pupilRows = await prisma.pupilEnrolment.findMany({
    where: { schoolId, academicYearId },
    select: { pupilId: true, yearGroupId: true },
  });
  const memberships = classGroups.flatMap((classGroup) => {
    const yearGroupCode = yearGroupCodeById.get(classGroup.yearGroupId);
    return pupilRows
      .filter((row) => yearGroupCodeById.get(row.yearGroupId) === yearGroupCode)
      .map((pupil) => ({ schoolId, classGroupId: classGroup.id, pupilId: pupil.pupilId }));
  });
  await insertBatches(memberships, (batch) => prisma.classMembership.createMany({ data: batch, skipDuplicates: true }));
}

function schoolDays(): Date[] {
  const days: Date[] = [];
  for (let date = dateOnly(2026, 9, 1); date <= SEED_DATE; date = new Date(date.getTime() + 86400000)) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(date);
  }
  return days.slice(-20);
}

async function createAttendance(schoolId: string, pupils: { id: string; admissionNumber: string }[]) {
  const attendanceCodeSpecs = [
    ["P", "Present", "present", true],
    ["L", "Late arrival", "late", true],
    ["I", "Illness", "authorised_absence", false],
    ["N", "Unauthorised absence", "unauthorised_absence", false],
    ["O", "Other authorised absence", "authorised_absence", false],
  ] as const;
  await insertBatches(attendanceCodeSpecs.map(([code, description, markType, countsAsPresent]) => ({ schoolId, code, description, markType, countsAsPresent })),
    (batch) => prisma.attendanceCode.createMany({ data: batch, skipDuplicates: true }));

  const sessions = schoolDays().flatMap((sessionDate) => ["morning", "afternoon"].map((sessionType) => ({ schoolId, sessionDate, sessionType })));
  await insertBatches(sessions, (batch) => prisma.attendanceSession.createMany({ data: batch, skipDuplicates: true }));
  const persistedSessions = await prisma.attendanceSession.findMany({ where: { schoolId }, select: { id: true, sessionDate: true, sessionType: true } });
  const rows = pupils.flatMap((pupil, pupilIndex) => {
    const missingCount = pupilIndex < 12 ? 11 : pupilIndex < 42 ? 4 : 1;
    const rankedSessions = [...persistedSessions].sort((left, right) =>
      stableNumber(`${pupil.admissionNumber}:${left.sessionDate.toISOString()}:${left.sessionType}`) -
      stableNumber(`${pupil.admissionNumber}:${right.sessionDate.toISOString()}:${right.sessionType}`));
    const absentSessionIds = new Set(rankedSessions.slice(0, missingCount).map((session) => session.id));
    const lateSessionIds = new Set(pupilIndex >= 42 && pupilIndex < 78
      ? rankedSessions.slice(missingCount, missingCount + 4).map((session) => session.id)
      : []);
    return persistedSessions.map((session) => {
      let attendanceCode = "P";
      if (absentSessionIds.has(session.id)) attendanceCode = pupilIndex % 2 === 0 ? "I" : "N";
      else if (lateSessionIds.has(session.id)) attendanceCode = "L";
      else if ((pupilIndex + session.sessionDate.getUTCDate()) % 173 === 0) attendanceCode = "O";
      return {
        schoolId,
        attendanceSessionId: session.id,
        pupilId: pupil.id,
        attendanceCode,
        markedAt: new Date(session.sessionDate.getTime() + (session.sessionType === "morning" ? 9 : 13) * 3600000),
      };
    });
  });
  await insertBatches(rows, (batch) => prisma.attendanceRecord.createMany({ data: batch, skipDuplicates: true }));
}

async function createBehaviourAndSupport(schoolId: string, pupils: { id: string }[]) {
  const positiveEntries = [
    ["positive", "Excellent contribution", "Made a thoughtful contribution during a lesson."],
    ["achievement", "Academic achievement", "Recognised for sustained effort in class."],
    ["reward", "Helping others", "Supported a classmate during a group activity."],
    ["achievement", "Sports achievement", "Represented the school positively at a fixture."],
    ["positive", "Community contribution", "Made a helpful contribution to the school community."],
  ];
  const otherEntries = [
    ["minor", "Reminder about classroom expectations", "A brief reminder was given and expectations were reviewed."],
    ["late", "Late to lesson", "Arrived after the lesson had started; follow-up recorded."],
    ["disruption", "Lesson disruption", "A low-level disruption was addressed by the member of staff."],
    ["detention", "Detention issued", "A short school detention was recorded."],
  ];
  const behaviourRows = Array.from({ length: 350 }, (_, index) => {
    const positive = index % 5 < 3;
    const [category, title, details] = (positive ? positiveEntries : otherEntries)[index % (positive ? positiveEntries.length : otherEntries.length)];
    return {
      schoolId,
      pupilId: pupils[Math.floor(index / 5)].id,
      seedKey: `behaviour:${String(index + 1).padStart(4, "0")}`,
      category,
      title,
      details,
      points: positive ? 1 + (index % 4) : -(1 + (index % 3)),
      parentVisible: positive || index % 2 === 0,
      occurredAt: new Date(Date.UTC(2026, 8, 2 + (index * 7) % 28, 9 + (index % 7))),
    };
  });
  const positiveCategories = new Set(["positive", "achievement", "reward"]);
  const rewards = behaviourRows.filter((row) => positiveCategories.has(row.category));
  const incidents = behaviourRows.filter((row) => !positiveCategories.has(row.category));
  await insertBatches(rewards, (batch) => prisma.behaviourReward.createMany({ data: batch, skipDuplicates: true }));
  await insertBatches(incidents, (batch) => prisma.behaviourIncident.createMany({ data: batch, skipDuplicates: true }));

  const sendProfiles = Array.from({ length: 35 }, (_, index) => ({
    schoolId,
    pupilId: pupils[80 + index].id,
    status: index % 5 === 0 ? "ehcp" : "sen_support",
    primaryNeed: ["Cognition and learning", "Communication and interaction", "Social and emotional", "Sensory and physical"][index % 4],
    supportLevel: index % 5 === 0 ? "high" : index % 3 === 0 ? "targeted" : "universal_plus",
    reviewDue: dateOnly(2027, 1 + (index % 6), 15),
  }));
  await insertBatches(sendProfiles, (batch) => prisma.sendProfile.createMany({ data: batch, skipDuplicates: true }));

  const conditionSpecs = [
    ["ASTHMA", "Asthma", "respiratory"],
    ["FOOD_ALLERGY", "Food allergy", "allergy"],
    ["SEASONAL_ALLERGY", "Seasonal allergy", "allergy"],
    ["EPILEPSY", "Epilepsy", "neurological"],
    ["DIABETES", "Diabetes", "endocrine"],
    ["MEDICATION", "Medication requirement", "medication"],
    ["MIGRAINE", "Migraine", "neurological"],
    ["ECZEMA", "Eczema", "skin"],
    ["COELIAC", "Coeliac disease", "dietary"],
    ["HEARING", "Hearing support", "sensory"],
  ] as const;
  await insertBatches(conditionSpecs.map(([code, name, category]) => ({ schoolId, code, name, category })),
    (batch) => prisma.medicalCondition.createMany({ data: batch, skipDuplicates: true }));
  const conditions = await prisma.medicalCondition.findMany({ where: { schoolId }, select: { id: true, code: true } });
  const conditionByCode = new Map(conditions.map((condition) => [condition.code, condition.id]));
  const medicalRows = Array.from({ length: 50 }, (_, index) => ({
    schoolId,
    pupilId: pupils[130 + index].id,
    medicalConditionId: conditionByCode.get(conditionSpecs[index % conditionSpecs.length][0])!,
    severity: index % 7 === 0 ? "moderate" : "mild",
    careNote: "Fictional development record; follow the school's approved care plan.",
  }));
  await insertBatches(medicalRows,
    (batch) => prisma.pupilMedicalCondition.createMany({ data: batch, skipDuplicates: true }));
}

async function validateSeed(schoolId: string): Promise<void> {
  const [schools, academicYears, terms, yearGroups, forms, departments, subjects, staff, teachers, pupils, parents, users, classes, classMemberships, attendance, behaviourIncidents, behaviourRewards, send, medical] = await Promise.all([
    prisma.school.count({ where: { id: schoolId } }),
    prisma.academicYear.count({ where: { schoolId } }),
    prisma.term.count({ where: { schoolId } }),
    prisma.yearGroup.count({ where: { schoolId } }),
    prisma.form.count({ where: { schoolId } }),
    prisma.department.count({ where: { schoolId } }),
    prisma.subject.count({ where: { schoolId } }),
    prisma.staffProfile.count({ where: { schoolId } }),
    prisma.staffProfile.count({ where: { schoolId, staffType: "teacher" } }),
    prisma.pupilProfile.count({ where: { schoolId } }),
    prisma.parentCarerProfile.count({ where: { schoolId } }),
    prisma.user.count({ where: { memberships: { some: { schoolId } } } }),
    prisma.classGroup.count({ where: { schoolId } }),
    prisma.classMembership.count({ where: { schoolId } }),
    prisma.attendanceRecord.count({ where: { schoolId } }),
    prisma.behaviourIncident.count({ where: { schoolId } }),
    prisma.behaviourReward.count({ where: { schoolId } }),
    prisma.sendProfile.count({ where: { schoolId } }),
    prisma.pupilMedicalCondition.count({ where: { schoolId } }),
  ]);
  const behaviour = behaviourIncidents + behaviourRewards;
  const counts = { schools, academicYears, terms, yearGroups, forms, departments, subjects, staff, teachers, pupils, parents, users, classes, classMemberships, attendance, behaviour, behaviourIncidents, behaviourRewards, send, medical };
  console.log("[SEED] Counts:", JSON.stringify(counts));
  const minimums: Record<string, [number, number]> = {
    schools: [schools, 1], academicYears: [academicYears, 1], terms: [terms, 3], yearGroups: [yearGroups, 7],
    forms: [forms, 18], departments: [departments, 15], subjects: [subjects, 20], staff: [staff, 60],
    teachers: [teachers, 30], pupils: [pupils, 300], parents: [parents, 220], users: [users, 590],
    classes: [classes, 50], classMemberships: [classMemberships, 5000], attendance: [attendance, 5000],
    behaviour: [behaviour, 300], send: [send, 30], medical: [medical, 40],
  };
  const failed = Object.entries(minimums).filter(([, [actual, expected]]) => actual < expected);
  if (failed.length > 0) {
    throw new Error(`Seed validation failed: ${failed.map(([name, [actual, expected]]) => `${name}=${actual} (expected at least ${expected})`).join(", ")}`);
  }
  const [studentsWithoutEnrolments, studentsWithoutContacts] = await Promise.all([
    prisma.pupilProfile.count({ where: { schoolId, enrolments: { none: { academicYear: { code: ACADEMIC_YEAR } } } } }),
    prisma.pupilProfile.count({ where: { schoolId, contacts: { none: { isPrimary: true } } } }),
  ]);
  if (studentsWithoutEnrolments || studentsWithoutContacts) {
    throw new Error("Seed validation failed: one or more required pupil/staff relationships are missing.");
  }

  const superAdmin = await prisma.user.findUnique({
    where: { emailNormalized: SUPER_ADMIN_EMAIL },
    select: {
      memberships: {
        where: { schoolId, status: "active" },
        select: {
          membershipRoles: {
            select: {
              role: {
                select: {
                  code: true,
                  rolePermissions: { select: { permissionCode: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const superAdminRole = superAdmin?.memberships
    .flatMap(({ membershipRoles }) => membershipRoles.map(({ role }) => role))
    .find(({ code }) => code === "SUPER_ADMIN");
  const missingSuperAdminPermissions = permissionSpecs
    .map(([code]) => code)
    .filter(
      (code) =>
        !superAdminRole?.rolePermissions.some(
          ({ permissionCode }) => permissionCode === code,
        ),
    );

  if (!superAdminRole || missingSuperAdminPermissions.length > 0) {
    throw new Error(
      `Seed validation failed: ${SUPER_ADMIN_EMAIL} must have an active SUPER_ADMIN membership and every seeded permission.`,
    );
  }
  console.log("[SEED] Relationship validation passed.");
}

async function main(): Promise<void> {
  await requireLocalDevelopmentDatabase();
  console.log("[SEED] Creating school...");
  const school = await prisma.school.upsert({
    where: { code: SCHOOL_CODE },
    create: { code: SCHOOL_CODE, name: SCHOOL_NAME, timezone: "Europe/London", status: "active" },
    update: { name: SCHOOL_NAME, timezone: "Europe/London", status: "active" },
  });
  console.log("[SEED] Creating academic structure...");
  const { academicYear, yearGroupByCode, departmentByCode } = await createAcademicStructure(school.id);
  console.log("[SEED] Creating roles, accounts, and memberships...");
  const { userByEmail } = await createRolesAndUsers(school.id);
  console.log("[SEED] Creating staff, students, parents, and enrolments...");
  const profiles = await createPeopleAndProfiles(school.id, academicYear.id, departmentByCode, userByEmail);
  console.log("[SEED] Creating classes and class memberships...");
  await createClasses(school.id, academicYear.id, new Map([...yearGroupByCode].map(([code, group]) => [code, group.id])));
  console.log("[SEED] Creating attendance records...");
  await createAttendance(school.id, profiles.pupils.map((pupil) => ({ id: pupil.id, admissionNumber: pupil.admissionNumber })));
  console.log("[SEED] Creating behaviour, SEND, and medical records...");
  await createBehaviourAndSupport(school.id, profiles.pupils.map((pupil) => ({ id: pupil.id })));
  console.log("[SEED] Running validation...");
  await validateSeed(school.id);
  console.log("[SEED] Complete. Development account password is documented in docs/SEED_DATA.md.");
}

main()
  .catch((error: unknown) => {
    console.error("[SEED] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());