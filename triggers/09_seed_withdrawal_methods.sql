-- ---------------------------------------------------------------------------
-- Seed: Default withdrawal methods
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ---------------------------------------------------------------------------

INSERT INTO withdrawal_methods (name, type, currency, min_amount, max_amount, processing_time, fee_percentage, fee_fixed, instructions, status, added_by, added_date, update_by, update_date, record_status)
VALUES
  ('Bank Transfer', 'bank',    'INR',  '500',   '500000', '1-3 business days', '0', '0', 'Provide your bank account details including account number, IFSC code, and account holder name.', 'active', 'system', NOW(), 'system', NOW(), 'S'),
  ('Bitcoin',       'crypto',  'BTC',  '0.001', '10',     'Within 24 hours',   '0', '0', 'Provide your Bitcoin wallet address. Ensure the address is correct as transactions cannot be reversed.',   'active', 'system', NOW(), 'system', NOW(), 'S'),
  ('Ethereum',      'crypto',  'ETH',  '0.01',  '100',    'Within 24 hours',   '0', '0', 'Provide your Ethereum wallet address. Ensure the address is correct as transactions cannot be reversed.',  'active', 'system', NOW(), 'system', NOW(), 'S'),
  ('USDT (TRC20)',  'crypto',  'USDT', '10',    '50000',  'Within 24 hours',   '0', '0', 'Provide your USDT TRC20 wallet address. Ensure the address is correct as transactions cannot be reversed.', 'active', 'system', NOW(), 'system', NOW(), 'S'),
  ('UPI',           'ewallet', 'INR',  '100',   '100000', 'Instant',           '0', '0', 'Provide your UPI ID for instant transfers.',                                                                'active', 'system', NOW(), 'system', NOW(), 'S')
ON CONFLICT DO NOTHING;
