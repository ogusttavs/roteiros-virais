import { NextResponse } from "next/server";

import { TETO_DA_FOTO_BYTES } from "@/config/carrossel";
import { adminDaRota, respostaDoAdmin } from "@/lib/porta-do-admin-da-rota";
import { idDoParametro, lerCorpoComTeto, respostaDoErroDoCarrossel } from "@/lib/porta-do-carrossel";
import { guardarIlustracao } from "@/servicos/ilustracoes-do-carrossel";

export const dynamic = "force-dynamic";

/**
 * E69 PR A, so admin: recebe a ilustracao do slide `n` (a partir de 1) de um carrossel, como o corpo cru da requisicao (JPEG ou PNG, ate 6 MB; o tipo vem dos bytes). `?generica=1` marca a imagem como generica
 * (estilo forte). O servidor reduz para JPEG de 1080 por 1350. Mandar de novo troca a anterior. Antes e depois e resultado respondem 400. Desligada a chave `ILUSTRACAO_ATIVA`, 404.
 */
export async function PUT(request: Request, contexto: { params: Promise<{ id: string; n: string }> }) {
  const admin = await adminDaRota();
  if (admin instanceof NextResponse) return admin;
  const parametros = await contexto.params;
  const id = idDoParametro(parametros.id);
  const n = idDoParametro(parametros.n);
  if (id === null || n === null) return respostaDoAdmin("nao encontrado", 404);
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > TETO_DA_FOTO_BYTES) return respostaDoAdmin("A imagem é grande demais.", 413);
  const corpo = await lerCorpoComTeto(request, TETO_DA_FOTO_BYTES);
  if (corpo === "grande-demais") return respostaDoAdmin("A imagem é grande demais.", 413);
  try {
    const { tamanho } = await guardarIlustracao(id, n - 1, { bytes: Buffer.from(corpo), generica: new URL(request.url).searchParams.get("generica") === "1" });
    return NextResponse.json({ ok: true, tamanho }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    throw erro;
  }
}
