-- ---------------------------------------------------------------------------
-- Seed: Ledger groups (role hierarchy)
--
-- These must exist before any user is created. Each role maps to a group_id
-- used throughout the double-entry accounting system.
--
-- RUN THIS MANUALLY IN THE DATABASE
-- ---------------------------------------------------------------------------

INSERT INTO ledger_groups (ledger_group_id, ledger_group_name, added_by, added_date, update_by, update_date, record_status)
VALUES
  (0, 'owner',           'system', NOW(), 'system', NOW(), 'S'),
  (1, 'capital',         'system', NOW(), 'system', NOW(), 'S'),
  (2, 'profit and loss', 'system', NOW(), 'system', NOW(), 'S'),
  (3, 'Admin',           'system', NOW(), 'system', NOW(), 'S'),
  (4, 'super',           'system', NOW(), 'system', NOW(), 'S'),
  (5, 'master',          'system', NOW(), 'system', NOW(), 'S'),
  (6, 'agent',           'system', NOW(), 'system', NOW(), 'S'),
  (7, 'user',            'system', NOW(), 'system', NOW(), 'S')
ON CONFLICT (ledger_group_id) DO NOTHING;
