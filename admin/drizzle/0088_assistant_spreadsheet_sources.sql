-- Extend bounded originals without changing RLS, immutable originals or publication fences.
ALTER TABLE app.assistant_knowledge_assets DROP CONSTRAINT assistant_knowledge_assets_format_check;
ALTER TABLE app.assistant_knowledge_assets ADD CONSTRAINT assistant_knowledge_assets_format_check
 CHECK(format IN ('docx','pdf','xlsx'));
ALTER TABLE app.assistant_knowledge_versions DROP CONSTRAINT assistant_source_file_shape;
ALTER TABLE app.assistant_knowledge_versions ADD CONSTRAINT assistant_source_file_shape CHECK(
 (source_asset_id IS NULL AND source_file IS NULL) OR
 (source_asset_id IS NOT NULL AND jsonb_typeof(source_file)='object' AND source_file->>'version'='1'
 AND source_file->>'assetId'=source_asset_id::text AND source_file->>'format' IN ('docx','pdf','xlsx')));
