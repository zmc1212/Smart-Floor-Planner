ALTER TABLE "app"."lead_lifecycle_events" DROP CONSTRAINT IF EXISTS "lead_lifecycle_events_action_check";

ALTER TABLE "app"."lead_lifecycle_events" ADD CONSTRAINT "lead_lifecycle_events_action_check"
  CHECK ("action" IN (
    'archived','restored','purged','converted','conversion_reverted',
    'closed_lost','reopened','referrer_withdrawn','referrer_withdrawal_reverted',
    'scheme_finalized','scheme_unfinalized','scheme_publications_withdrawn'
  ));
