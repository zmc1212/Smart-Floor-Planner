-- The restored PostgreSQL baseline enforces roles separately from the Drizzle schema.
ALTER TABLE app.admin_users DROP CONSTRAINT admin_users_role_check;
ALTER TABLE app.admin_users ADD CONSTRAINT admin_users_role_check
 CHECK(role IN ('super_admin','admin','enterprise_admin','designer','salesperson','measurer','viewer','construction_staff'));
