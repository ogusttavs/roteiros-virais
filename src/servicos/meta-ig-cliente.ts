/**
 * Resolve `clientes.meta_ig_id` (V8, item 1 do PROXIMO.md): o id da conta do
 * Instagram do cliente na Graph API da Meta, quando essa conta esta entre as
 * Paginas que o usuario do sistema do nosso token enxerga
 * (`acessos/meta-app.md`). Sem correspondencia, o id fica nulo e a curva do
 * Instagram desse cliente continua pelo Apify, sem erro: `resolverMetaIgId`
 * nunca lanca por falta de correspondencia, so por falha de rede ou de
 * configuracao, e mesmo assim devolve `null` em vez de lancar (chamado tanto
 * de uma Server Action quanto de dentro do job da curva, nenhum dos dois
 * pode cair por causa disto).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes } from "@/db/schema";
import { buscarPaginasComInstagram, ErroMetaApi, erroMetaEhTokenOuLimite } from "@/jobs/meta-api";
import { config } from "@/lib/config";
import { normalizarHandle } from "@/servicos/curva";

/**
 * Instagram nao diferencia maiusculas de minusculas no nome de usuario; o que
 * o cliente digita no briefing e o `username` que a Graph API devolve podem
 * vir com caixa diferente (`normalizarHandle` ja tira o "@" e os espacos).
 */
export function handleBateComUsername(handleNormalizado: string, username: string): boolean {
  return handleNormalizado.toLowerCase() === username.toLowerCase();
}

/**
 * Ja resolvido: devolve o que esta salvo, sem chamar a API de novo. Sem
 * `META_ATIVO` (ou faltando `META_IG_ID`/`META_TOKEN`): `null` sem tentar,
 * mesma condicao de `config.coleta.metaAtivo` que os outros jobs da Meta
 * usam. Sem perfil de Instagram no briefing: `null` sem chamar a API. Sem
 * correspondencia entre o handle e nenhuma Pagina: `null`, mas tenta de novo
 * na proxima chamada (o cliente pode ganhar acesso a Pagina depois). Um erro
 * de rede devolve `null` da mesma forma.
 *
 * Um erro de TOKEN OU DE LIMITE (`erroMetaEhTokenOuLimite`) e diferente: ele
 * afeta TODAS as contas, nao so esta, e e RELANCADO em vez de virar `null`
 * (achado da revisao da V8: engolir esse erro aqui, igual ao "sem
 * correspondencia", fazia o job da curva tentar a Meta de novo a cada
 * cliente sem `meta_ig_id` ainda resolvido, em vez de parar assim que o
 * primeiro desses erros aparece). Quem chama de um lugar interativo (a
 * Server Action de `/conta`) so precisa nao esperar por isto (ver
 * `salvarPerfilConta`, que dispara sem `await`): esperar `aguardarJanela`
 * (`meta-api.ts`) esvaziar a janela de uma hora prenderia a tela de salvar
 * por quase uma hora, e nenhum caminho interativo fazia isso antes da V8.
 */
export async function resolverMetaIgId(clienteId: number): Promise<string | null> {
  if (!config.coleta.metaAtivo) return null;

  const [cliente] = await db()
    .select({ perfis: clientes.perfis, metaIgId: clientes.metaIgId })
    .from(clientes)
    .where(eq(clientes.id, clienteId));
  if (!cliente) return null;
  if (cliente.metaIgId) return cliente.metaIgId;

  const handleBruto = cliente.perfis?.instagram;
  if (!handleBruto?.trim()) return null;
  const handle = normalizarHandle(handleBruto, "instagram");

  let paginas: Awaited<ReturnType<typeof buscarPaginasComInstagram>>;
  try {
    paginas = await buscarPaginasComInstagram();
  } catch (erro) {
    if (erro instanceof ErroMetaApi && erroMetaEhTokenOuLimite(erro)) throw erro;
    // Rede caida: tenta de novo na proxima chamada, sem marcar nada.
    return null;
  }

  const achada = paginas.find((pagina) => handleBateComUsername(handle, pagina.username));
  if (!achada) return null;

  await db().update(clientes).set({ metaIgId: achada.instagramBusinessAccountId }).where(eq(clientes.id, clienteId));
  return achada.instagramBusinessAccountId;
}
