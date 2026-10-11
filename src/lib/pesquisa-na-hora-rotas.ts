/**
 * E54 (parte 3): os endereços que a pesquisa na hora liga entre si (puro, testado por tabela). A pesquisa guarda no servidor o que a pessoa estava fazendo (`DestinoDaPesquisa`); daqui
 * saem o endereço da tela que vem depois dos dados marcados e o de onde "Mudar o pedido" volta.
 */
import type { DestinoDaPesquisa } from "@/db/schema";

/** `/criar/objetivo?livre=...`, com tudo o que veio preso ao tema, e `pesquisa=<id>` quando a pessoa seguiu com a pesquisa (sem ele, é o Tema livre de sempre). */
export function enderecoDoObjetivo(destino: Extract<DestinoDaPesquisa, { tipo: "objetivo" }>, pesquisaId?: number): string {
  const c = destino.consulta;
  const consulta = new URLSearchParams();
  consulta.set("livre", c.livre);
  if (c.alta) consulta.set("alta", c.alta);
  if (c.noticiaId) consulta.set("noticiaId", c.noticiaId);
  if (c.noticiaAssuntoId) consulta.set("noticiaAssuntoId", c.noticiaAssuntoId);
  if (c.pergunta) consulta.set("pergunta", c.pergunta);
  if (pesquisaId) consulta.set("pesquisa", String(pesquisaId));
  if (c.data) consulta.set("data", c.data);
  return `/criar/objetivo?${consulta.toString()}`;
}

/** De onde a pessoa veio: o Tema livre com o texto dela (`?tema=` vence o rascunho), ou o Criar quando foi o momento. */
export function enderecoParaMudarOPedido(destino: DestinoDaPesquisa | null): string {
  if (destino?.tipo === "objetivo") {
    const c = destino.consulta;
    const consulta = new URLSearchParams({ tema: c.livre });
    if (c.alta) consulta.set("alta", c.alta);
    if (c.noticiaId) consulta.set("noticiaId", c.noticiaId);
    if (c.noticiaAssuntoId) consulta.set("noticiaAssuntoId", c.noticiaAssuntoId);
    if (c.pergunta) consulta.set("pergunta", c.pergunta);
    if (c.data) consulta.set("data", c.data);
    return `/criar/tema-livre?${consulta.toString()}`;
  }
  return "/criar";
}
