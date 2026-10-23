"use server";

import { headers } from "next/headers";

import { registrarInteresse, type ErrosDoInteresse } from "@/servicos/interessados";
import { textosInteressados } from "@/textos/interessados";

export type ResultadoQueroTestar = { ok: true } | { ok: false; erros?: ErrosDoInteresse; erro?: string };

/**
 * O IP de quem pede, só para o limite de pedidos (nunca vai para o banco). Atrás do Caddy, `x-forwarded-for` é o endereço de quem chegou ao Caddy (ele não repassa o que o
 * navegador mandou nesse cabeçalho). Sem o cabeçalho (desenvolvimento), todos caem na mesma chave "sem-ip".
 */
function ipDoPedido(cabecalhos: Headers): string {
  const encaminhado = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (encaminhado || cabecalhos.get("x-real-ip")?.trim() || "sem-ip").slice(0, 64);
}

/**
 * O "Quero testar" da página de entrada (E57a). Rota pública: não há sessão nem `exigirAdmin`; a defesa é a validação no servidor, o limite de pedidos e o teto geral por hora
 * (`registrarInteresse`). Devolve só o que a tela precisa: ok, o erro de cada campo ou a frase do limite. Nada do que está no banco volta ao navegador.
 */
export async function queroTestarAction(dados: unknown): Promise<ResultadoQueroTestar> {
  const resultado = await registrarInteresse(dados, { ip: ipDoPedido(await headers()) });
  if (resultado.ok) return { ok: true };
  if (resultado.motivo === "limite") return { ok: false, erro: textosInteressados.erros.limite };
  return { ok: false, erros: resultado.erros };
}
