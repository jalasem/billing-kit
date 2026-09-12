-- Ledger invariants enforced in Postgres, not just in application code.

-- 1. Every entry's postings must sum to zero per currency. Checked as a
-- deferred constraint trigger so it fires once at commit, after every
-- posting belonging to the entry has been inserted, regardless of order.
CREATE OR REPLACE FUNCTION check_entry_balances() RETURNS trigger AS $$
DECLARE
  unbalanced RECORD;
BEGIN
  SELECT currency, SUM(amount) AS total INTO unbalanced
  FROM postings
  WHERE entry_id = NEW.entry_id
  GROUP BY currency
  HAVING SUM(amount) <> 0
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Entry % does not balance for currency %: postings sum to %',
      NEW.entry_id, unbalanced.currency, unbalanced.total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER postings_balance_check
AFTER INSERT ON postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_entry_balances();

-- 2. A posting's currency must match its account's currency.
CREATE OR REPLACE FUNCTION check_posting_currency() RETURNS trigger AS $$
DECLARE
  account_currency char(3);
BEGIN
  SELECT currency INTO account_currency FROM accounts WHERE id = NEW.account_id;

  IF account_currency IS NULL THEN
    RAISE EXCEPTION 'Posting references unknown account %', NEW.account_id;
  END IF;

  IF NEW.currency <> account_currency THEN
    RAISE EXCEPTION 'Posting currency % does not match account % currency %',
      NEW.currency, NEW.account_id, account_currency;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER postings_currency_check
BEFORE INSERT ON postings
FOR EACH ROW
EXECUTE FUNCTION check_posting_currency();

-- 3. Entries and postings are append-only: no UPDATE or DELETE, ever.
-- Corrections are new, reversing entries.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the ledger is append-only', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER postings_no_update BEFORE UPDATE ON postings
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER postings_no_delete BEFORE DELETE ON postings
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
