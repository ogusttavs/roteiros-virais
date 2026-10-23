import type { ContaLigadaVista } from "@/servicos/conta-conectada";
import { type CodigoDoRetorno, textosLigacao } from "@/textos/conta-conectada";

/**
 * E19 PR 2: o que o cartão "Seu Instagram" da Conta mostra, montado no servidor a partir do que `servicos/conta-conectada.ts` devolve. Datas já formatadas aqui (fuso do Brasil), para
 * o servidor e o navegador não discordarem na hora de montar a tela; nada do acesso guardado passa por aqui (a `ContaLigadaVista` não leva o token).
 */

const FUSO = "America/Sao_Paulo";
const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: FUSO });
const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: FUSO });

export function formatarDia(data: Date): string {
  return dia.format(data);
}

export function formatarDiaEHora(data: Date): string {
  return `${dia.format(data)} às ${hora.format(data)}`;
}

/** Os códigos que a volta do diálogo da Meta pode mandar em `/conta?instagram=<código>`; qualquer outro valor é ignorado. */
export function codigoDoRetorno(valor: string | string[] | undefined): CodigoDoRetorno | null {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  return bruto && Object.prototype.hasOwnProperty.call(textosLigacao.retorno, bruto) ? (bruto as CodigoDoRetorno) : null;
}

export type TomDoRetorno = "ok" | "aviso";

export type VisaoSeuInstagram = {
  /** Os dados do aplicativo da Meta estão no ambiente (`ligacaoDisponivel()`): sem eles não há botão para ninguém. */
  ligacaoAberta: boolean;
  /** A Meta já aprovou o aplicativo para todo mundo (`META_APP_APROVADO=1`): some o aviso do grupo pequeno. */
  aprovadoPelaMeta: boolean;
  /** É a dona da marca e não está no "ver como": só ela vê os botões. */
  podeMexer: boolean;
  /** É dona da marca, mas está no "ver como" (o cartão fica só de leitura). */
  verComo: boolean;
  /** A conta ativa, ou `null`. */
  conta: { nome: string; pagina: string | null; desde: string; ultimaLeitura: string | null; erro: string | null } | null;
  /** As contas à espera da escolha; vazio para quem não pode mexer. */
  candidatas: { contaId: string; nome: string; pagina: string | null }[];
  /** A frase da volta do diálogo, quando a página abriu com `?instagram=`. */
  retorno: { codigo: CodigoDoRetorno; frase: string; tom: TomDoRetorno } | null;
};

export type EntradaDaVisao = {
  ligacaoAberta: boolean;
  aprovadoPelaMeta: boolean;
  dono: boolean;
  verComo: boolean;
  conta: ContaLigadaVista | null;
  candidatas: ContaLigadaVista[];
  retorno: CodigoDoRetorno | null;
};

const RETORNOS_BONS: ReadonlySet<CodigoDoRetorno> = new Set(["ligada", "escolher"]);

export function montarVisaoSeuInstagram(entrada: EntradaDaVisao): VisaoSeuInstagram {
  const podeMexer = entrada.dono && !entrada.verComo;
  return {
    ligacaoAberta: entrada.ligacaoAberta,
    aprovadoPelaMeta: entrada.aprovadoPelaMeta,
    podeMexer,
    verComo: entrada.verComo,
    conta: entrada.conta
      ? {
          nome: entrada.conta.nome,
          pagina: entrada.conta.paginaNome,
          desde: formatarDia(entrada.conta.conectadaEm),
          ultimaLeitura: entrada.conta.ultimaLeituraEm ? formatarDiaEHora(entrada.conta.ultimaLeituraEm) : null,
          erro: entrada.conta.erro,
        }
      : null,
    // A lista de escolha é de quem pode escolher: nem membro nem o "ver como" a veem (e a ação recusaria de qualquer jeito).
    candidatas: podeMexer ? entrada.candidatas.map((c) => ({ contaId: c.contaId, nome: c.nome, pagina: c.paginaNome })) : [],
    retorno: entrada.retorno
      ? { codigo: entrada.retorno, frase: textosLigacao.retorno[entrada.retorno], tom: RETORNOS_BONS.has(entrada.retorno) ? "ok" : "aviso" }
      : null,
  };
}

/** Os estados do cartão, para os testes e para o `data-estado` da tela. */
export type EstadoDoCartao = "indisponivel" | "sem-ligacao" | "escolher" | "ligada";

export function estadoDoCartao(visao: VisaoSeuInstagram): EstadoDoCartao {
  if (visao.candidatas.length > 0) return "escolher";
  if (visao.conta) return "ligada";
  return visao.ligacaoAberta ? "sem-ligacao" : "indisponivel";
}
