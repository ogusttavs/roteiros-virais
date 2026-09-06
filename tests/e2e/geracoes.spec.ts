/**
 * Resumo de `/admin/geracoes` (etapa 18, definicao de pronto): os chips de
 * periodo e o filtro por tarefa mudam a URL e o que a tela mostra. Nao
 * assume nenhuma geracao especifica ja existir (outros arquivos de e2e
 * rodam no mesmo banco compartilhado, em ordem que este arquivo nao
 * controla): o filtro por tarefa so testa a troca de verdade quando existe
 * mais de uma opcao alem de "todas as tarefas".
 */
import { expect, test } from "@playwright/test";

const EMAIL_ADMIN = "admin@exemplo.teste";
const SENHA_ADMIN = "ExemploSenha123";

test("periodo (chips) e filtro por tarefa mudam a URL e a tela", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN);
  await page.getByLabel("Senha").fill(SENHA_ADMIN);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/clientes/);

  await page.goto("/admin/geracoes");
  await expect(page.getByRole("heading", { name: "Gerações", exact: true })).toBeVisible();

  const chip7 = page.getByRole("link", { name: "7 dias" });
  const chip30 = page.getByRole("link", { name: "30 dias" });
  await expect(chip7).toHaveAttribute("aria-current", "true");
  await expect(chip30).not.toHaveAttribute("aria-current", "true");

  // O contador do topo segue o mesmo período dos chips (rodada de acabamento
  // de 06/09, item 5), nunca a lista de recentes: sem contagem exata (o
  // banco e compartilhado com outros arquivos de e2e), so o período no texto.
  await expect(page.getByText(/gerações? em 7 dias/)).toBeVisible();

  await chip30.click();
  await expect(page).toHaveURL(/periodo=30/);
  await expect(chip30).toHaveAttribute("aria-current", "true");
  await expect(chip7).not.toHaveAttribute("aria-current", "true");
  await expect(page.getByText(/gerações? em 30 dias/)).toBeVisible();

  const filtroTarefa = page.getByLabel("tarefa", { exact: true });
  await expect(filtroTarefa).toBeVisible();
  const opcoes = await filtroTarefa.locator("option").all();
  if (opcoes.length > 1) {
    const valor = await opcoes[1].getAttribute("value");
    await filtroTarefa.selectOption({ index: 1 });
    await expect(page).toHaveURL(new RegExp(`tarefa=${valor}`));
    // O periodo escolhido antes continua na URL: os dois filtros sao independentes.
    await expect(page).toHaveURL(/periodo=30/);
  }

  const filtroCliente = page.getByLabel("cliente", { exact: true });
  await expect(filtroCliente).toBeVisible();
});
