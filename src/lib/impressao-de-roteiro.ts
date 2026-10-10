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

/** O que o pedido com `?marcas=1` decidiu: se a folha vai com as marcas, e se a pessoa pediu e não deu (a folha sai sem elas, e a tela diz em uma frase). */
export type DecisaoDasMarcas = { comMarcas: boolean; naoDeu: boolean };

/**
 * "No PDF e na imagem, com as marcas de fala" (E41 2c): o pedido leva `?marcas=1`. O arquivo SEMPRE sai (a pessoa pediu o PDF; a marca é acessório): se as marcas não puderam ser escritas
 * (a IA caiu, o teto do dia chegou, o texto mudou duas vezes no meio, ou a navegação veio de outro site), a folha sai sem elas e `naoDeu` manda a rota avisar (`X-Marcas: nao-deu`).
 * Só vai com as marcas quando o roteiro tem fala para marcar (Reels falado) e elas existem para o texto de agora; se ainda não existem, escreve na hora (uma chamada, uma vez, como em
 * `marcarFalaDoRoteiro`). No "ver como" nada é escrito. Erro que não é da marcação sobe.
 */
export async function pedidoComMarcas(request: Request, roteiro: RoteiroLinha, cliente: Cliente, somenteLeitura: boolean): Promise<DecisaoDasMarcas> {
  if (new URL(request.url).searchParams.get("marcas") !== "1") return { comMarcas: false, naoDeu: false };
  // Quem escreve é a tela da própria pessoa (fetch da mesma origem) ou o endereço digitado: uma navegação que veio de outro site não gasta uma marcação (`Sec-Fetch-Site`).
  const origem = request.headers.get("sec-fetch-site");
  const podeEscrever = !somenteLeitura && (origem === null || origem === "same-origin" || origem === "none");
  const fala = falaDoRoteiro(roteiro, !podeEscrever);
  if (!fala.podeMarcar) return { comMarcas: false, naoDeu: false };
  if (fala.marcas) return { comMarcas: true, naoDeu: false };
  if (!podeEscrever) return { comMarcas: false, naoDeu: true };
  try {
    // Duas tentativas: se o texto mudou no meio da marcação ("editado_no_meio"), a segunda já pega o texto de agora.
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const resultado = await marcarFalaDoRoteiro(cliente.id, roteiro.id);
      if (resultado.ok) return { comMarcas: true, naoDeu: false };
      if (resultado.motivo !== "editado_no_meio") return { comMarcas: false, naoDeu: false };
    }
    return { comMarcas: false, naoDeu: true };
  } catch (erro) {
    // A IA caiu ou o teto do dia chegou: é esperado (sem Sentry). O arquivo sai sem as marcas, e a tela diz.
    if (erro instanceof ErroIA || erro instanceof ErroRoteiro) {
      logger.warn({ err: erro, roteiroId: roteiro.id }, "as marcas de fala do pdf ou da imagem nao puderam ser escritas: o arquivo sai sem elas");
      return { comMarcas: false, naoDeu: true };
    }
    throw erro;
  }
}

/** O cabeçalho que diz à tela que as marcas pedidas não vieram (o PDF) e o campo equivalente da imagem. */
export const CABECALHO_DAS_MARCAS = "X-Marcas";
export const VALOR_NAO_DEU = "nao-deu";

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
