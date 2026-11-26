/**
 * M4 da auditoria de segurança de 26/11/2026: o Chromium do carrossel (os slides e a redução da ilustração) e o do roteiro em PDF e em imagem rodam dentro do `roteiros-app`, que enxerga a
 * rede interna (`roteiros-postgres`) e o disco do painel. O HTML dos slides escapa todo texto (`src/carrossel/modelos.ts`) e a folha de impressão é React (que escapa), então hoje nada de fora
 * entra neles; esta é a segunda camada, a mesma da animação (`src/animacao/render.ts`): se um escape for esquecido num modelo novo, o navegador continua sem buscar nada de fora.
 *
 * O carrossel (`paginaSemRede`), com três travas, cada uma com teste em `tests/integracao/carrossel-rede.test.ts`:
 * 1. toda requisição que não é `data:` (a letra, o fundo, a foto e a ilustração vão embutidos assim) é abortada no contexto, o que inclui `http`, `https`, `file` e qualquer endereço interno;
 * 2. o JavaScript da página fica desligado: só o código do próprio render roda (`page.evaluate` não depende dele), e um `<script>` que entrasse no HTML não roda;
 * 3. nenhum servidor resolve (`--host-resolver-rules`), nem pelo nome nem escrito em número: o que escapasse da rota (uma pré-conexão, um WebSocket) não acha `roteiros-postgres`, 169.254.169.254
 *    nem outro servidor.
 *
 * O PDF e a imagem do roteiro (`abrirChromiumDaFolha` e `paginaSoDaOrigem`): a folha é uma página do próprio painel (`127.0.0.1:PORT/roteiros/[id]/imprimir`), com o CSS, a letra e o
 * JavaScript do Next servidos por ele. Duas travas, com teste no mesmo arquivo:
 * 1. passa o que é da origem da folha e o `data:`; o resto (outro servidor, outra porta, `file`, endereço interno) é abortado. O JavaScript fica ligado ali: a folha é a mesma página do painel;
 * 2. só o servidor da folha resolve (`MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`), o que vale também para endereço escrito em número (169.254.169.254). É o que segura o pulo (um 302): a rota do
 *    Playwright só vê o primeiro endereço de um pedido que pula, o destino do pulo sai sem passar por ela (medido em 26/11/2026).
 *
 * O sandbox do Chromium continua desligado (padrão do Playwright no Linux): ligar no `roteiros-app` pede mudar o Compose (perfil de seccomp ou capacidade) e um ensaio, ver o PR.
 */
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";

import { logger } from "@/lib/log";

export const ARGUMENTOS_SEM_REDE = ["--host-resolver-rules=MAP * ~NOTFOUND"];

type OpcoesDaPagina = Pick<BrowserContextOptions, "viewport" | "deviceScaleFactor">;

/** O que o HTML gerado pode buscar: só o que vem embutido nele (`data:`). */
export function pedidoDoProprioHtml(url: string): boolean {
  return url.trimStart().toLowerCase().startsWith("data:");
}

/** O que a folha de impressão pode buscar: o que vem embutido nela e o que é da mesma origem dela (esquema, servidor e porta iguais). `file:` tem origem "null" e nunca passa. */
export function pedidoDaMesmaOrigem(url: string, origem: string): boolean {
  if (pedidoDoProprioHtml(url)) return true;
  try {
    const daUrl = new URL(url).origin;
    return daUrl !== "null" && daUrl === origem;
  } catch {
    return false;
  }
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

/** O argumento que deixa resolver só o servidor do endereço da folha (o painel, `127.0.0.1`). Um servidor com caractere fora do esperado não vira argumento: lança. */
export function argumentosDaFolha(endereco: string): string[] {
  const servidor = new URL(endereco).hostname;
  if (!/^[a-z0-9.-]+$/i.test(servidor)) throw new Error("endereco da folha com servidor inesperado");
  return [`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${servidor}`];
}

export function abrirChromiumDaFolha(endereco: string): Promise<Browser> {
  return chromium.launch({ args: argumentosDaFolha(endereco) });
}

/** Um contexto próprio que aborta todo pedido que `passa` recusa, sem service worker (que escaparia da rota) nem download. */
async function paginaQueSoBusca(navegador: Browser, passa: (url: string) => boolean, opcoes: BrowserContextOptions): Promise<Page> {
  const contexto = await navegador.newContext({ ...opcoes, serviceWorkers: "block", acceptDownloads: false });
  await contexto.route("**/*", (rota) => {
    const url = rota.request().url();
    if (passa(url)) return rota.continue();
    logger.warn({ destino: destinoDoPedido(url) }, "chromium sem rede: um pedido de fora foi barrado");
    return rota.abort("blockedbyclient");
  });
  return contexto.newPage();
}

/** O carrossel: uma página num contexto próprio, com as três travas: sem rede, sem o JavaScript da página, sem service worker nem download. */
export function paginaSemRede(navegador: Browser, opcoes: OpcoesDaPagina = {}): Promise<Page> {
  return paginaQueSoBusca(navegador, pedidoDoProprioHtml, { ...opcoes, javaScriptEnabled: false });
}

/** O PDF e a imagem do roteiro: uma página que só busca da origem de `endereco` (a folha de impressão do próprio painel) e o que vem embutido. */
export function paginaSoDaOrigem(navegador: Browser, endereco: string, opcoes: OpcoesDaPagina = {}): Promise<Page> {
  const origem = new URL(endereco).origin;
  return paginaQueSoBusca(navegador, (url) => pedidoDaMesmaOrigem(url, origem), opcoes);
}
