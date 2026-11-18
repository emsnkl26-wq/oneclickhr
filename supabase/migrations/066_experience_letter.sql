-- ============================================================================
-- 066_experience_letter.sql
--
-- Add 'experience_letter' to generated_document_type.  The old
-- 'internship_offer' value stays for existing rows; new letters are
-- produced under either 'offer_letter' (which now covers internship
-- offers too) or 'experience_letter'.
-- ============================================================================

alter type public.generated_document_type add value if not exists 'experience_letter';
