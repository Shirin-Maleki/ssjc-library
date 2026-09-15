import { test, expect, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_STAFF_PASSWORD } from "../../playwright.config";

async function loginAsStaff(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Tap to Enter" }).click();
  await page.getByLabel("Staff password", { exact: true }).fill(E2E_STAFF_PASSWORD);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page).toHaveURL("/home");
}

test.describe("Welcome and staff login", () => {
  test("renders the welcome screen without exposing the password field up front", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SSJC Library" })).toBeVisible();
    await expect(page.getByText("Staff access")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tap to Enter" })).toBeVisible();
    await expect(page.getByLabel("Staff password", { exact: true })).toHaveCount(0);
  });

  test("Tap to Enter reveals the password field", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Tap to Enter" }).click();
    await expect(page.getByLabel("Staff password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter" })).toBeVisible();
  });

  test("an incorrect password shows an error and does not navigate away", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Tap to Enter" }).click();
    await page.getByLabel("Staff password", { exact: true }).fill("definitely-wrong");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("That password didn't work. Please try again.")).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("the show/hide toggle changes the field's input type", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Tap to Enter" }).click();
    const field = page.getByLabel("Staff password", { exact: true });
    await expect(field).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show staff password" }).click();
    await expect(field).toHaveAttribute("type", "text");
  });

  test("a correct password logs in and reaches Home", async ({ page }) => {
    await loginAsStaff(page);
    await expect(page.getByRole("heading", { name: "Find a Book" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add a Book" })).toBeVisible();
  });

  test("keyboard-only submission works end to end", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Tap to Enter" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Staff password", { exact: true })).toBeVisible();
    await page.getByLabel("Staff password", { exact: true }).fill(E2E_STAFF_PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/home");
  });
});

test.describe("Route protection", () => {
  test("visiting a protected route without a session redirects to Welcome", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Tap to Enter" })).toBeVisible();
  });

  test("each staff destination requires a session", async ({ page }) => {
    for (const path of ["/find", "/add", "/lists", "/guide", "/teacher-catalog", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL("/");
    }
  });
});

test.describe("Logout", () => {
  test("logging out returns to Welcome and re-protects Home", async ({ page }) => {
    await loginAsStaff(page);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/home");
    await expect(page).toHaveURL("/");
  });
});

test.describe("Admin elevation", () => {
  test("a staff-only session sees the admin unlock prompt, not the dashboard", async ({ page }) => {
    await loginAsStaff(page);
    await page.getByRole("link", { name: "Admin" }).click();
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByText("Enter the admin password to continue.")).toBeVisible();
    await expect(page.getByLabel("Admin password", { exact: true })).toBeVisible();
  });

  test("an incorrect admin password is rejected", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/admin");
    await page.getByLabel("Admin password", { exact: true }).fill("definitely-wrong");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("That password didn't work. Please try again.")).toBeVisible();
    await expect(page.getByLabel("Admin password", { exact: true })).toBeVisible();
  });

  test("a correct admin password reveals the admin placeholder state", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/admin");
    await page.getByLabel("Admin password", { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL("/admin");
    await expect(page.getByText("Review queues, taxonomy management, and import tools")).toBeVisible();
  });

  test("logging out clears admin elevation along with the session", async ({ page }) => {
    await loginAsStaff(page);
    await page.goto("/admin");
    await page.getByLabel("Admin password", { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("Review queues, taxonomy management, and import tools")).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/admin");
    await expect(page).toHaveURL("/");
  });
});
