/**
 * E26 4b, parte 2: "escrever o roteiro" no Criar passou a escrever as três versões do tema, e o roteiro só nasce quando a pessoa fica com uma. Os e2e que só querem chegar ao roteiro (e testam
 * o que vem depois: a ficha, a data, a notícia de origem) ficam com a primeira, que é a de nota mais alta.
 */
import { expect, type Page } from "@playwright/test";

export async function ficarComAPrimeiraVersao(page: Page, timeout = 60_000): Promise<void> {
  await expect(page).toHaveURL(/\/criar\/versoes\/[0-9a-f-]{36}/, { timeout });
  await page.getByRole("button", { name: "Ficar com esta" }).first().click();
}
