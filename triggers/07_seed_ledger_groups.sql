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
  (0, 'owner',           'system', NOW(), 'system', NOW(), 2),
  (1, 'capital',         'system', NOW(), 'system', NOW(), 2),
  (2, 'profit and loss', 'system', NOW(), 'system', NOW(), 2),
  (3, 'Admin',           'system', NOW(), 'system', NOW(), 2),
  (4, 'super',           'system', NOW(), 'system', NOW(), 2),
  (5, 'master',          'system', NOW(), 'system', NOW(), 2),
  (6, 'agent',           'system', NOW(), 'system', NOW(), 2),
  (7, 'user',            'system', NOW(), 'system', NOW(), 2)
ON CONFLICT (ledger_group_id) DO NOTHING;
