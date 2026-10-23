/**
 * Para onde vai quem tem sessao e nao tem marca ativa (22/10/2026). Antes, `/hoje` mandava para `/comecar`, `/comecar` mandava para `/entrar` e `/entrar`, com sessao,
 * mandava de volta para `/hoje`: laco de redirecionamentos ("muitos redirecionamentos" no navegador). Isso aconteceu em producao com a conta cuja marca foi apagada, e
 * acontece com um convite sem marca ligada.
 *
 * Esta e a unica decisao: todo ponto que descobre "a sessao existe e nao ha marca" chama `destinoSemMarca`; `/entrar` (que decide para onde levar quem ja tem sessao) chama
 * `destinoDaSessao`. O admin nunca para na tela de conta sem marca: o lugar dele e `/admin`, com ou sem marca ligada. Funcao pura, sem banco, para dar para testar.
 */
export const ROTA_SEM_MARCA = "/sem-marca";

type Papel = string | null | undefined;

/** Sessao existe, a marca ativa nao: para onde mandar. */
export function destinoSemMarca(papel: Papel): "/admin" | typeof ROTA_SEM_MARCA {
  return papel === "admin" ? "/admin" : ROTA_SEM_MARCA;
}

/** Quem ja tem sessao e abre `/entrar` (ou qualquer porta de entrada): o admin vai ao `/admin`, o cliente com marca ao `/hoje`, o cliente sem marca a tela propria. */
export function destinoDaSessao(papel: Papel, temMarca: boolean): "/admin" | "/hoje" | typeof ROTA_SEM_MARCA {
  if (papel === "admin") return "/admin";
  return temMarca ? "/hoje" : ROTA_SEM_MARCA;
}
