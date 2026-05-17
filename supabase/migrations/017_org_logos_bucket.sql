-- Storage bucket for org logos (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  524288,  -- 512 KB
  ARRAY['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload/replace logos
CREATE POLICY "authenticated users can upload org logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'org-logos');

CREATE POLICY "authenticated users can update org logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'org-logos');

-- Anyone can read logos (used in sidebar, emails, etc.)
CREATE POLICY "org logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'org-logos');
