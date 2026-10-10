import { NextResponse } from "next/server";

import type { Cliente } from "@/db/schema";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { criarTokenImpressao } from "@/lib/tokenImpressao";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { roteiroPorId, type RoteiroLinha } from "@/servicos/roteiro";

/**
 * O que o PDF (`/api/roteiros/[id]/pdf`) e a imagem para o celular (`/api/roteiros/[id]/imagem`) têm em comum (E26): a checagem de sessão e de posse do roteiro e o endereço da página de
 * impressão com o token. A guarda no Chromium, o tempo limite e o pé do PDF estão em `chromium-de-impressao.ts` (puros, com teste).
 */

/** O roteiro e a marca de quem pediu, ou a resposta de erro que a rota devolve (sem sessão, id inválido, roteiro de outra marca). */
export async function roteiroDeQuemPediu(params: Promise<{ id: string }>): Promise<{ roteiro: RoteiroLinha; cliente: Cliente } | NextResponse> {
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
  return { roteiro, cliente };
}

/**
 * `127.0.0.1:PORT`, nunca `config.appUrl` (achado testando a imagem de produção): o Playwright roda dentro do próprio processo do servidor, e `APP_URL` é o endereço público, atrás do proxy.
 * Navegar para ele faria o container sair para a internet só para voltar nele mesmo, e falha quando o endereço público não resolve de dentro da rede da VPS.
 *
 * O token vale 60 s: as rotas chamam isto DENTRO da vaga do Chromium (`comLimiteDeChromium`), logo antes de navegar, e não antes de esperar na fila; senão um pedido que esperou mais que isso
 * navegaria com o token vencido e receberia a página 404 no lugar do roteiro.
 */
export function urlDeImpressao(roteiro: RoteiroLinha, cliente: Cliente, formato: "a4" | "celular"): string {
  const token = criarTokenImpressao(roteiro.id, cliente.id);
  return `http://127.0.0.1:${process.env.PORT ?? 3000}/roteiros/${roteiro.id}/imprimir?token=${encodeURIComponent(token)}&formato=${formato}`;
}
