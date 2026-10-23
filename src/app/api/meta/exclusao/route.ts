import { NextResponse, type NextRequest } from "next/server";

import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { tratarExclusaoDaMeta } from "@/servicos/conta-conectada";

export const dynamic = "force-dynamic";

/**
 * E19 PR 1: o aviso de exclusão de dados da Meta (a URL cadastrada em "URL de solicitação de exclusão de dados" no aplicativo; `docs/meta/exclusao-de-dados-callback.md`). Quem chama é a
 * Meta, sem cookie (`middleware.ts` deixa passar); a autenticação é a assinatura do `signed_request` com o segredo do aplicativo, conferida antes de qualquer outra coisa.
 *
 * Respostas: 503 sem o segredo configurado (falha fechada); 400 com assinatura que não bate ou corpo sem `signed_request`; 200 com `{ url, confirmation_code }` quando atendeu (a Meta mostra
 * os dois à pessoa). O `signed_request` nunca é escrito em log.
 */
export async function POST(req: NextRequest) {
  if (!config.metaConexao.appSecret) {
    logger.error("meta: META_APP_SECRET nao esta definido; aviso de exclusao recusado");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  let signedRequest: string | null = null;
  try {
    signedRequest = new URLSearchParams(await req.text()).get("signed_request");
  } catch {
    signedRequest = null;
  }
  const resposta = await tratarExclusaoDaMeta(signedRequest);
  if (!resposta) {
    logger.warn("meta: aviso de exclusao com assinatura invalida recusado");
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  return NextResponse.json(resposta);
}
