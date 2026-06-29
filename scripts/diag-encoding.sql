SHOW server_encoding;
SHOW client_encoding;
SELECT pg_encoding_to_char(encoding) AS db_encoding FROM pg_database WHERE datname = current_database();
SELECT id, title, char_length(title) AS chars, octet_length(title) AS bytes
FROM activities
WHERE title ~ '[^\x00-\x7F]'
ORDER BY created_at DESC
LIMIT 10;
