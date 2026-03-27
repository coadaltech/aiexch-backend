-- ═══════════════════════════════════════════════════════════════════════════
-- Function: get_user_count_by_role
-- Returns the count of users grouped by role (Admin, Super, Master, Agent, User)
-- Excludes system accounts (group_id < 3) and Owner (role = 0)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_count_by_role()
    RETURNS TABLE (
        role_name TEXT,
        user_count BIGINT
    )
    LANGUAGE 'plpgsql'
AS $BODY$
BEGIN
    RETURN QUERY
    SELECT
        CASE u.role
            WHEN 3 THEN 'Admin'
            WHEN 4 THEN 'Super'
            WHEN 5 THEN 'Master'
            WHEN 6 THEN 'Agent'
            WHEN 7 THEN 'User'
            ELSE 'Unknown'
        END AS role_name,
        COUNT(*)::BIGINT AS user_count
    FROM users u
    WHERE u.role IN (3, 4, 5, 6, 7)
      AND u.record_status = 1
    GROUP BY u.role
    ORDER BY u.role;
END;
$BODY$;

ALTER FUNCTION public.get_user_count_by_role()
    OWNER TO postgres;
