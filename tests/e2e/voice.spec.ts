import { test, expect, type Page } from "@playwright/test";
import { loginAsStaff } from "./helpers";

interface FakeRecognitionBehavior {
  transcript?: string;
  error?: string;
  /** When true, `start()` fires `onstart` and then does nothing further until the app
   * itself calls `stop()`/`abort()` — used for tests that need a real window to act
   * while "still listening," where the usual short auto-resolve would race the test. */
  neverResolves?: boolean;
}

/**
 * Installs a scripted fake `SpeechRecognition` before any application code runs
 * (docs/TESTING.md) — this exercises the real production `useVoiceSearch`/
 * `SearchInput`/`VoiceSearchButton` end to end, against a fully controlled browser
 * API, never a fake speech endpoint or a production-only "E2E voice" switch.
 */
async function installFakeSpeechRecognition(page: Page, behavior: FakeRecognitionBehavior) {
  await page.addInitScript((behavior: FakeRecognitionBehavior) => {
    class FakeSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private timer: ReturnType<typeof setTimeout> | null = null;

      start() {
        this.onstart?.();
        if (behavior.neverResolves) return;
        this.timer = setTimeout(() => {
          this.timer = null;
          if (behavior.error) {
            this.onerror?.({ error: behavior.error });
            this.onend?.();
            return;
          }
          const transcript = behavior.transcript ?? "";
          this.onresult?.({
            resultIndex: 0,
            results: { length: 1, 0: { length: 1, isFinal: true, 0: { transcript, confidence: 1 } } },
          });
          this.onend?.();
        }, 30);
      }

      stop() {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.onend?.();
      }

      abort() {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        this.onend?.();
      }
    }

    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSpeechRecognition;
  }, behavior);
}

async function removeSpeechRecognitionSupport(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
}

test.describe("Voice search", () => {
  test("Home -> Find a Book -> voice -> mocked transcript -> normal results", async ({ page }) => {
    await installFakeSpeechRecognition(page, { transcript: "dinosaurs" });
    await loginAsStaff(page);
    await page.getByRole("link", { name: /Find a Book/ }).click();
    await expect(page).toHaveURL("/find");

    await page.getByRole("button", { name: "Search by voice" }).click();
    await expect(page).toHaveURL(/\/find\?q=dinosaurs/);
    await expect(page.getByText(/\d+ matches?/)).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveValue("dinosaurs");
  });

  test("existing filters survive a voice search exactly as they survive a typed one", async ({ page }) => {
    await installFakeSpeechRecognition(page, { transcript: "bedtime stories" });
    await loginAsStaff(page);
    await page.goto("/find?lang=sv");

    await page.getByRole("button", { name: "Search by voice" }).click();
    await expect(page).toHaveURL(/q=bedtime/);
    await expect(page).toHaveURL(/lang=sv/);
  });

  test("no-speech shows calm recovery copy and does not navigate to an empty search", async ({ page }) => {
    await installFakeSpeechRecognition(page, { error: "no-speech" });
    await loginAsStaff(page);
    await page.goto("/find");

    await page.getByRole("button", { name: "Search by voice" }).click();
    // The message renders twice by design: once visible, once in a visually-hidden
    // aria-live region for screen readers — .first() disambiguates.
    await expect(page.getByText(/didn't catch anything/i).first()).toBeVisible();
    await expect(page).toHaveURL("/find");
  });

  test("permission denied shows calm recovery copy and typed search still works", async ({ page }) => {
    await installFakeSpeechRecognition(page, { error: "not-allowed" });
    await loginAsStaff(page);
    await page.goto("/find");

    await page.getByRole("button", { name: "Search by voice" }).click();
    await expect(page.getByText(/microphone access is blocked/i).first()).toBeVisible();

    await page.getByRole("combobox").fill("Eric Carle");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=Eric/);
  });

  test("cancel restores the prior query and does not navigate", async ({ page }) => {
    await installFakeSpeechRecognition(page, { neverResolves: true });
    await loginAsStaff(page);
    await page.goto("/find?q=eric+carle");

    await page.getByRole("button", { name: "Search by voice" }).click();
    await page.getByRole("button", { name: "Cancel voice search" }).click();
    await expect(page.getByRole("combobox")).toHaveValue("eric carle");
    await expect(page).toHaveURL(/q=eric(\+|%20)carle/);
  });

  test("unsupported browser shows an honest fallback, not a broken mic button", async ({ page }) => {
    await removeSpeechRecognitionSupport(page);
    await loginAsStaff(page);
    await page.goto("/find");

    await expect(page.getByRole("button", { name: "Search by voice" })).toHaveCount(0);
    await expect(page.getByText(/voice search isn't supported in this browser/i)).toBeVisible();

    await page.getByRole("combobox").fill("dinosaurs");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=dinosaurs/);
  });
});
