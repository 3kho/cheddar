-- Ledger guarantees enforced by Postgres itself, so no app bug can break them.

-- 1. Append-only: journal entries and ledger lines can never be changed or removed.
CREATE FUNCTION cheddar_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION cheddar_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION cheddar_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION cheddar_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_no_truncate BEFORE TRUNCATE ON ledger_lines
  FOR EACH STATEMENT EXECUTE FUNCTION cheddar_reject_mutation();
--> statement-breakpoint

-- 2. Balance cache: every line updates its account's balance. The UPDATE takes a
--    row lock on the account (serialising concurrent spenders) and re-checks
--    accounts_non_negative, which rejects any overdraft.
CREATE FUNCTION cheddar_apply_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_lines_apply AFTER INSERT ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION cheddar_apply_line();
--> statement-breakpoint

-- 3. Double entry: each journal entry's lines must sum to zero, checked at COMMIT.
CREATE FUNCTION cheddar_check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total FROM ledger_lines WHERE entry_id = NEW.entry_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (sum = %)', NEW.entry_id, total;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_lines_balanced AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cheddar_check_entry_balanced();
--> statement-breakpoint

-- 4. The single churn issuance account: the only place new Latta comes from.
INSERT INTO accounts (kind) VALUES ('churn_issuance');
