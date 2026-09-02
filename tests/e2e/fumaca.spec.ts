import { expect, test } from "@playwright/test";

test("a pagina inicial abre", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
});
