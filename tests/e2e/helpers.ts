import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { E2E_STAFF_PASSWORD } from "../../playwright.config";

export async function loginAsStaff(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Tap to Enter" }).click();
  await page.getByLabel("Staff password", { exact: true }).fill(E2E_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page).toHaveURL("/home");
}
