DO $$
DECLARE
  invalid_acquired_count bigint;
  commission_without_confirmation_count bigint;
BEGIN
  SELECT count(*)
  INTO invalid_acquired_count
  FROM "app"."leads"
  WHERE "status" = 'acquired' AND "acquired_at" IS NULL;

  SELECT count(*)
  INTO commission_without_confirmation_count
  FROM "app"."lead_acquisition_commissions" commission
  JOIN "app"."leads" lead ON lead."id" = commission."lead_id"
  WHERE lead."acquired_at" IS NULL;

  IF invalid_acquired_count > 0 THEN
    RAISE WARNING 'acquisition workbench migration found % acquired leads without acquired_at; lifecycle status will be restored to new without inventing a confirmation timestamp', invalid_acquired_count;
  END IF;

  IF commission_without_confirmation_count > 0 THEN
    RAISE WARNING 'acquisition workbench migration found % commissions without acquired_at; manual repair is required and no timestamp will be invented', commission_without_confirmation_count;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "app"."leads"
SET "status" = 'new', "updated_at" = now()
WHERE "status" = 'acquired';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_assignee_acquired_created_idx" ON "app"."leads" USING btree ("assigned_to", "acquired_at", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_promoter_acquired_created_idx" ON "app"."leads" USING btree ("promoter_id", "acquired_at", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_users_wechat_qr_asset_idx" ON "app"."admin_users" USING btree ("wechat_qr_asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_acquired_by_idx" ON "app"."leads" USING btree ("acquired_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_acquisition_commissions_designer_idx" ON "app"."lead_acquisition_commissions" USING btree ("designer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_acquisition_commissions_settled_by_idx" ON "app"."lead_acquisition_commissions" USING btree ("settled_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_notifications_enterprise_idx" ON "app"."staff_notifications" USING btree ("enterprise_id");
