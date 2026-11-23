SET search_path = ledger;
-- accounts for FX, fees, holds
SELECT open_account('wallet:user_42:USD', 'liability', 'USD');
SELECT open_account('fx:clearing:KES', 'asset', 'KES', true);
SELECT open_account('fx:clearing:USD', 'asset', 'USD', true);
SELECT open_account('revenue:fees:KES', 'revenue', 'KES');
SELECT open_account('holds:user_42:KES', 'liability', 'KES');
SELECT open_account('payable:merchant_7:KES', 'liability', 'KES');

-- top up the wallet again for the demo
SELECT post_entry('deposit-2', 'Top up', '[
 {"account":"cash:bank:KES","direction":"debit","amount":5000000},
 {"account":"wallet:user_42:KES","direction":"credit","amount":5000000}]');

-- FX: KES 12,950.00 becomes USD 100.00. Balances per currency.
SELECT post_entry('fx-1', 'Convert KES to USD at 129.50', '[
 {"account":"wallet:user_42:KES","direction":"debit","amount":1295000},
 {"account":"fx:clearing:KES","direction":"credit","amount":1295000},
 {"account":"fx:clearing:USD","direction":"debit","amount":10000},
 {"account":"wallet:user_42:USD","direction":"credit","amount":10000}]');

-- Payment with fee split: user pays KES 1,000, merchant gets 985, platform keeps 15
SELECT post_entry('pay-1', 'Payment to merchant 7', '[
 {"account":"wallet:user_42:KES","direction":"debit","amount":100000},
 {"account":"payable:merchant_7:KES","direction":"credit","amount":98500},
 {"account":"revenue:fees:KES","direction":"credit","amount":1500}]');

-- Hold: reserve KES 2,000 for a pending card authorisation
SELECT post_entry('hold-1', 'Hold for auth 991', '[
 {"account":"wallet:user_42:KES","direction":"debit","amount":200000},
 {"account":"holds:user_42:KES","direction":"credit","amount":200000}]');
-- Release half as capture, half back
SELECT post_entry('capture-1', 'Capture auth 991', '[
 {"account":"holds:user_42:KES","direction":"debit","amount":200000},
 {"account":"payable:merchant_7:KES","direction":"credit","amount":150000},
 {"account":"wallet:user_42:KES","direction":"credit","amount":50000}]');

-- Refund via reversal of pay-1
SELECT reverse_entry((SELECT id FROM journal_entries WHERE idempotency_key='pay-1'), 'refund-pay-1', 'Refund payment to merchant 7');

-- cross-currency unbalanced should fail
DO $$ BEGIN
 PERFORM post_entry('bad-fx', 'bad', '[
 {"account":"wallet:user_42:KES","direction":"debit","amount":1000},
 {"account":"wallet:user_42:USD","direction":"credit","amount":1000}]');
EXCEPTION WHEN others THEN RAISE NOTICE 'rejected: %', SQLERRM; END $$;

SELECT a.code, signed_balance(a.type,b.debits_posted,b.credits_posted)/100.0 AS balance, a.currency
FROM accounts a JOIN account_balances b ON b.account_id=a.id ORDER BY a.id;

SELECT currency, sum(CASE WHEN direction='debit' THEN amount ELSE -amount END) net FROM postings GROUP BY currency;
