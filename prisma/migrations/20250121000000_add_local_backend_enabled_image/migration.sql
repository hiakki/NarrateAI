-- Add LOCAL_BACKEND to enabledImageProviders so "Local Backend" appears as an image option
-- for users who want to use their local server for image generation.
UPDATE "admin_settings"
SET "enabledImageProviders" = "enabledImageProviders" || '["LOCAL_BACKEND"]'::jsonb
WHERE NOT ("enabledImageProviders" @> '["LOCAL_BACKEND"]');
