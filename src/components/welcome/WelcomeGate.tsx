"use client";

import { useState } from "react";
import { authenticateStaff } from "@/lib/auth/actions";
import { SecretGate } from "@/components/auth/SecretGate";
import { Button } from "@/components/ui/Button";

export function WelcomeGate() {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <div className="w-full max-w-sm">
        <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>
          Tap to Enter
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm [animation:gentle-reveal_200ms_ease-out]">
      <SecretGate
        action={authenticateStaff}
        fieldLabel="Staff password"
        submitLabel="Enter"
        pendingLabel="Entering…"
        autoFocus
      />
    </div>
  );
}
