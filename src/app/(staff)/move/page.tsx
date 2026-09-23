import { MoveBookFlow } from "@/components/move/MoveBookFlow";

/**
 * The Move/Return workflow's page (Phase 9 addendum) — unlike Add a Book, this
 * never touches Google Drive (the movement photo is never uploaded/stored),
 * so there's no Drive-configuration gate here. If book identification itself
 * isn't configured, `identifyBookForMoveAction` returns a calm
 * `configuration_missing` failure the flow already displays inline.
 */
export default function MovePage() {
  return (
    <div className="mx-auto w-full max-w-lg">
      <MoveBookFlow />
    </div>
  );
}
