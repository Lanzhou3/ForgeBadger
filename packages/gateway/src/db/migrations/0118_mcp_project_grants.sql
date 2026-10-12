-- NULL preserves legacy directory and account-scoped grants without expanding authority.
ALTER TABLE mcp_access_tokens ADD COLUMN allowed_projects TEXT;
