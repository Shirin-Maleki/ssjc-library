import { logout } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";

export function LogoutForm() {
  return (
    <form action={logout}>
      <Button type="submit" variant="ghost" size="md" className="h-9 px-3 text-sm">
        Log out
      </Button>
    </form>
  );
}
