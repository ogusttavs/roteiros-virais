/**
 * M4 da auditoria de segurança de 26/11/2026: o Chromium do carrossel (os slides e a redução da ilustração) roda dentro do `roteiros-app`, que enxerga a rede interna (`roteiros-postgres`) e
 * o disco do painel. O HTML dos slides escapa todo texto (`src/carrossel/modelos.ts`), então hoje nada de fora entra nele; esta é a segunda camada, a mesma da animação
 * (`src/animacao/render.ts`): se um escape for esquecido num modelo novo, o navegador continua sem buscar nada que não esteja embutido no próprio HTML.
 *
 * Três travas, cada uma com teste em `tests/integracao/carrossel-rede.test.ts`:
 * 1. toda requisição que não é `data:` (a letra, o fundo, a foto e a ilustração vão embutidos assim) é abortada no contexto, o que inclui `http`, `https`, `file` e qualquer endereço interno;
 * 2. o JavaScript da página fica desligado: só o código do próprio render roda (`page.evaluate` não depende dele), e um `<script>` que entrasse no HTML não roda;
 * 3. o nome de nenhum servidor resolve (`--host-resolver-rules`): o que escapasse da rota (uma pré-conexão, um WebSocket) não acha `roteiros-postgres` nem outro nome.
 *
 * O sandbox do Chromium continua desligado (padrão do Playwright no Linux): ligar no `roteiros-app` pede mudar o Compose (perfil de seccomp ou capacidade) e um ensaio, ver o PR.
 */
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";

import { logger } from "@/lib/log";

export const ARGUMENTOS_SEM_REDE = ["--host-resolver-rules=MAP * ~NOTFOUND"];

/** O que o HTML gerado pode buscar: só o que vem embutido nele (`data:`). */
export function pedidoDoProprioHtml(url: string): boolean {
  return url.trimStart().toLowerCase().startsWith("data:");
}

/** De onde era o pedido barrado, para o registro: só o esquema e o servidor, nunca o caminho nem a consulta. */
function destinoDoPedido(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "endereco invalido";
  }
}

export function abrirChromiumSemRede(): Promise<Browser> {
  return chromium.launch({ args: ARGUMENTOS_SEM_REDE });
}

/** Uma página num contexto próprio, com as três travas: sem rede, sem o JavaScript da página, sem service worker nem download. */
export async function paginaSemRede(navegador: Browser, opcoes: Pick<BrowserContextOptions, "viewport" | "deviceScaleFactor"> = {}): Promise<Page> {
  const contexto = await navegador.newContext({ ...opcoes, javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false });
  await contexto.route("**/*", (rota) => {
    const url = rota.request().url();
    if (pedidoDoProprioHtml(url)) return rota.continue();
    logger.warn({ destino: destinoDoPedido(url) }, "chromium sem rede: um pedido de fora do html foi barrado");
    return rota.abort("blockedbyclient");
  });
  return contexto.newPage();
}
