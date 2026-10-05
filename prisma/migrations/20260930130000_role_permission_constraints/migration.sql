ALTER TABLE role_permissions
  RENAME CONSTRAINT role_permissions_permission_fkey
  TO role_permissions_permission_code_fkey;

ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_school_id_fkey
  FOREIGN KEY (school_id)
  REFERENCES schools(id)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
