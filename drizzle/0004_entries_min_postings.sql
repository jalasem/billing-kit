-- An entry with fewer than two postings is not a double-entry transaction.
-- Deferred so postings inserted after the entry, in the same transaction,
-- are counted before the check runs at commit.
CREATE OR REPLACE FUNCTION check_entry_min_postings() RETURNS trigger AS $$
DECLARE
  posting_count integer;
BEGIN
  SELECT count(*) INTO posting_count FROM postings WHERE entry_id = NEW.id;

  IF posting_count < 2 THEN
    RAISE EXCEPTION 'Entry % must have at least two postings, has %', NEW.id, posting_count;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entries_min_postings_check
AFTER INSERT ON entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_entry_min_postings();