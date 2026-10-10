import { NextResponse } from "next/server";

import type { Cliente } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { logger } from "@/lib/log";
import { criarTokenImpressao } from "@/lib/tokenImpressao";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { falaDoRoteiro, marcarFalaDoRoteiro } from "@/servicos/marcar-fala";
import { ErroRoteiro, roteiroPorId, type RoteiroLinha } from "@/servicos/roteiro";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

/**
 * O que o PDF (`/api/roteiros/[id]/pdf`) e a imagem para o celular (`/api/roteiros/[id]/imagem`) têm em comum (E26): a checagem de sessão e de posse do roteiro e o endereço da página de
 * impressão com o token. A guarda no Chromium, o tempo limite e o pé do PDF estão em `chromium-de-impressao.ts` (puros, com teste).
 */

/**
 * O roteiro e a marca de quem pediu, ou a resposta de erro que a rota devolve (sem sessão, id inválido, roteiro de outra marca). `somenteLeitura` é o "ver como": a rota só lê, nada se
 * escreve em nome de outra pessoa (nem as marcas de fala que o PDF pediu).
 */
export async function roteiroDeQuemPediu(
  params: Promise<{ id: string }>,
): Promise<{ roteiro: RoteiroLinha; cliente: Cliente; somenteLeitura: boolean } | NextResponse> {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const roteiroId = idDaRotaOuNulo(id);
  if (roteiroId === null) {
    return NextResponse.json({ erro: "roteiro invalido" }, { status: 404 });
  }

  const roteiro = await roteiroPorId(roteiroId, cliente.id);
  if (!roteiro) {
    return NextResponse.json({ erro: "roteiro nao encontrado" }, { status: 404 });
  }
  return { roteiro, cliente, somenteLeitura: sessao.verComo != null };
}

/**
 * "No PDF e na imagem, com as marcas de fala" (E41 2c): o pedido leva `?marcas=1`. Devolve se a folha vai com as marcas. Só vai com as marcas quando o roteiro tem fala para marcar
 * (Reels falado) e elas existem para o texto de agora; se ainda não existem, escreve na hora (a pessoa pediu: uma chamada, uma vez, como em `marcarFalaDoRoteiro`). No "ver como" nada é
 * escrito: sem marcas prontas, a folha sai como sempre. Erro da IA sobe: o PDF não sai sem as marcas que a pessoa pediu, sem avisar.
 */
export async function pedidoComMarcas(request: Request, roteiro: RoteiroLinha, cliente: Cliente, somenteLeitura: boolean): Promise<boolean> {
  if (new URL(request.url).searchParams.get("marcas") !== "1") return false;
  // Quem escreve é a tela da própria pessoa (fetch da mesma origem) ou o endereço digitado: uma navegação que veio de outro site não gasta uma marcação (`Sec-Fetch-Site`).
  const origem = request.headers.get("sec-fetch-site");
  const podeEscrever = !somenteLeitura && (origem === null || origem === "same-origin" || origem === "none");
  const fala = falaDoRoteiro(roteiro, !podeEscrever);
  if (!fala.podeMarcar) return false;
  if (fala.marcas) return true;
  if (!podeEscrever) return false;
  // Duas tentativas: se o texto mudou no meio da marcação ("editado_no_meio"), a segunda já pega o texto de agora.
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const resultado = await marcarFalaDoRoteiro(cliente.id, roteiro.id);
    if (resultado.ok) return true;
    if (resultado.motivo !== "editado_no_meio") return false;
  }
  return false;
}

/** A resposta da rota quando as marcas pedidas não puderam ser escritas (a IA caiu, ou o teto do dia): a frase vai à tela, sem Sentry (é esperado), e o PDF não sai sem avisar. */
export function respostaDeMarcasQueFalharam(erro: unknown): NextResponse | null {
  if (erro instanceof ErroIA) {
    logger.warn({ err: erro }, "as marcas de fala do pdf ou da imagem nao puderam ser escritas");
    return NextResponse.json({ erro: "marcas", mensagem: textosMarcasDeFala.erros.naoNoPapel }, { status: 502 });
  }
  if (erro instanceof ErroRoteiro) {
    return NextResponse.json({ erro: "marcas", mensagem: `${erro.message} ${textosMarcasDeFala.erros.desligueParaBaixar}` }, { status: 429 });
  }
  return null;
}

/**
 * `127.0.0.1:PORT`, nunca `config.appUrl` (achado testando a imagem de produção): o Playwright roda dentro do próprio processo do servidor, e `APP_URL` é o endereço público, atrás do proxy.
 * Navegar para ele faria o container sair para a internet só para voltar nele mesmo, e falha quando o endereço público não resolve de dentro da rede da VPS.
 *
 * O token vale 60 s: as rotas chamam isto DENTRO da vaga do Chromium (`comLimiteDeChromium`), logo antes de navegar, e não antes de esperar na fila; senão um pedido que esperou mais que isso
 * navegaria com o token vencido e receberia a página 404 no lugar do roteiro.
 */
export function urlDeImpressao(roteiro: RoteiroLinha, cliente: Cliente, formato: "a4" | "celular", comMarcas = false): string {
  const token = criarTokenImpressao(roteiro.id, cliente.id);
  return `http://127.0.0.1:${process.env.PORT ?? 3000}/roteiros/${roteiro.id}/imprimir?token=${encodeURIComponent(token)}&formato=${formato}${comMarcas ? "&marcas=1" : ""}`;
}
