-- Preserve existing authorized staff/lead removal, without orphaned project grants.
ALTER TABLE app.construction_members DROP CONSTRAINT construction_members_enterprise_id_admin_id_fkey;
ALTER TABLE app.construction_members ADD CONSTRAINT construction_member_staff
 FOREIGN KEY(enterprise_id,admin_id) REFERENCES app.admin_users(enterprise_id,id) ON DELETE CASCADE;
ALTER TABLE app.construction_projects DROP CONSTRAINT construction_projects_enterprise_id_lead_id_fkey;
ALTER TABLE app.construction_projects ADD CONSTRAINT construction_project_lead
 FOREIGN KEY(enterprise_id,lead_id) REFERENCES app.leads(enterprise_id,id) ON DELETE CASCADE;
