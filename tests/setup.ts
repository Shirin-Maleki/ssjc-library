// Test-only fixture value — never a real credential. Session logic needs a secret
// present to sign/verify tokens; unit tests never touch a real deployment.
process.env.SESSION_SECRET ??= "test-only-session-secret-do-not-use-in-real-env";
