const staffPermissionCodes = [
  "school.read",
  "school.members.read",
  "school.members.manage",
  "audit.read",
  "school.structure.read",
  "pupils.read",
  "pupils.manage",
  "attendance.read",
  "attendance.register",
  "attendance.manage",
  "academic.read",
  "academic.manage",
  "exams.manage",
  "admissions.manage",
  "finance.manage",
  "safeguarding.report",
  "safeguarding.manage",
  "behaviour.manage",
  "send.manage",
  "medical.manage",
  "calendar.read",
  "calendar.manage",
  "documents.read",
  "documents.manage",
  "communications.read",
  "communications.manage",
  "notifications.manage",
  "website.edit",
  "website.publish",
];
const teacherPermissionCodes = staffPermissionCodes.filter(
  (permissionCode) =>
    ![
      "school.members.read",
      "school.members.manage",
      "pupils.manage",
      "attendance.manage",
      "academic.manage",
      "exams.manage",
      "admissions.manage",
      "finance.manage",
      "safeguarding.manage",
      "send.manage",
      "medical.manage",
      "notifications.manage",
    ].includes(permissionCode),
);

export function schoolMembershipRole(
  code: string,
  permissionCodes = ["PARENT", "STUDENT"].includes(code)
    ? []
    : code === "SUPER_ADMIN"
      ? [...staffPermissionCodes, "calendar.publish", "school.roles.manage"]
      : code === "TEACHER"
        ? teacherPermissionCodes
        : [...staffPermissionCodes, "calendar.publish"],
) {
  return {
    role: {
      code,
      rolePermissions: permissionCodes.map((permissionCode) => ({ permissionCode })),
    },
  };
}
