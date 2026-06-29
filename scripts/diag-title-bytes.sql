-- Mostra os bytes crus de títulos com '?', replacement char (�) ou char fora de ascii+latin1
SELECT id, title,
       char_length(title) AS chars, octet_length(title) AS bytes,
       encode(convert_to(title,'UTF8'),'escape') AS raw_bytes
FROM activities
WHERE title LIKE '%?%'
   OR title LIKE ('%' || E'�' || '%')
   OR title ~ '[^\x00-\x7FÀ-ÿ]'
ORDER BY created_at DESC
LIMIT 20;
