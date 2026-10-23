-- Keep media timestamps distinct from the business database's system clock.
ALTER TABLE app.construction_camera_recording_periods
 ADD COLUMN source_started_at timestamptz, ADD COLUMN source_ended_at timestamptz,
 ADD COLUMN clock_offset_min_ms integer, ADD COLUMN clock_offset_max_ms integer,
 ADD CONSTRAINT construction_recording_period_clock CHECK(
  (source_started_at IS NULL AND clock_offset_min_ms IS NULL AND clock_offset_max_ms IS NULL)
  OR (source_started_at IS NOT NULL AND clock_offset_min_ms IS NOT NULL AND clock_offset_max_ms IS NOT NULL AND clock_offset_min_ms<=clock_offset_max_ms)),
 ADD CONSTRAINT construction_recording_period_source_time CHECK(source_ended_at IS NULL OR source_ended_at>=source_started_at);
ALTER TABLE app.construction_recordings
 ADD COLUMN clock_offset_min_ms integer NOT NULL DEFAULT 0,
 ADD COLUMN clock_offset_max_ms integer NOT NULL DEFAULT 0,
 ADD CONSTRAINT construction_recording_clock CHECK(clock_offset_min_ms<=clock_offset_max_ms);
-- Applied periods without source-clock evidence are not guessed retroactively.
UPDATE app.construction_camera_recording_policies SET imported_until=NULL,index_swept_at=NULL,scan_from=NULL,scan_to=NULL,scan_page=1;
