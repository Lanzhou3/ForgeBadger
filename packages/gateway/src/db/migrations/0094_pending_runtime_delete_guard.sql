CREATE TRIGGER preserve_pending_runtime_confirmation
BEFORE DELETE ON session_runtime_confirmations
WHEN OLD.status = 'pending'
BEGIN
 SELECT RAISE(ABORT, 'SESSION_RUNTIME_STOP_UNCONFIRMED');
END;
