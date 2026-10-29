/**
 * E47 PR 3: o miolo da decisão da edição, sem banco e sem fila. Recebe a fala, a curva de energia, o roteiro e a marca; chama o modelo forte, monta o plano pelo motor de corte, confere
 * pelo código e pelo verificador barato, e devolve o resultado. É o que `servicos/decidir-edicao.ts` (o job, com banco) e `scripts/avaliar-edicao.ts` (o golden set) usam, para as duas
 * provas medirem a mesma coisa. Quem chama decide como registrar cada chamada ao modelo (`chamar`).
 *
 * No máximo `decisoesPorEdicao` (2) decisões do modelo forte: a segunda só existe se a primeira reprovou, e leva os motivos.
 */
import { AJUSTES_DA_EDICAO } from "@/config/edicao";
import type { DecisaoDaEdicao, ResultadoDaEdicao } from "@/db/schema";
import { montarPlano } from "@/edicao/decisao";
import type { Energia, PalavraFalada } from "@/edicao/tipos";
import { conferirLocal, limparAvisos } from "@/edicao/verificacao";
import { gerarEstruturado } from "@/ia/cliente";
import * as decidirIA from "@/ia/prompts/decidirEdicao";
import * as verificarIA from "@/ia/prompts/verificarEdicao";
import type { ResultadoGeracao, TarefaIA } from "@/ia/tipos";

/** O que o modelo precisa saber do roteiro e da marca. */
export type ContextoDaEdicao = {
  roteiro: decidirIA.EntradaDecidirEdicao["roteiro"];
  /** Todo o texto do roteiro, junto, para conferir o título (número e promessa). */
  textoDoRoteiro: string;
  marca: { nome: string; resumo: string };
  /** Os nomes que a legenda precisa escrever certo. */
  nomes: string[];
};

/** Quem faz a chamada ao modelo e a registra (geração, tokens, custo). O núcleo só diz qual tarefa e quais detalhes numéricos. */
export type Chamador = <T>(tarefa: TarefaIA, versao: string, nivel: "forte" | "barato", detalhes: Record<string, unknown>, fazer: () => Promise<ResultadoGeracao<T>>) => Promise<T>;

export type EntradaDoNucleo = {
  palavras: PalavraFalada[];
  energia: Energia;
  duracaoS: number;
  contexto: ContextoDaEdicao;
  /** Uma decisão que já passou nas conferências do código numa rodada anterior: retoma do verificador, sem pagar a decisão de novo. */
  decisaoGuardada?: DecisaoDaEdicao | null;
  chamar: Chamador;
  /** Chamado quando uma decisão passa nas conferências do código e antes do verificador: o job guarda para poder retomar. */
  aoPassarNoCodigo?: (decisao: DecisaoDaEdicao, resultado: ResultadoDaEdicao) => Promise<void>;
  agora: Date;
};

export type SaidaDoNucleo = {
  estado: "verificado" | "para_revisao";
  decisao: DecisaoDaEdicao | null;
  resultado: ResultadoDaEdicao | null;
  /** Quantas decisões do modelo forte (ou 1, se retomou de uma guardada) foram usadas. */
  decisoes: number;
  /** Os motivos da última reprovação (vazio se verificado). */
  problemas: string[];
};

export async function decidirEVerificar(entrada: EntradaDoNucleo): Promise<SaidaDoNucleo> {
  const { palavras, energia, contexto, chamar } = entrada;
  let guardada: DecisaoDaEdicao | null = entrada.decisaoGuardada ?? null;
  let motivos: string[] = [];
  let ultimo: { decisao: DecisaoDaEdicao; resultado: ResultadoDaEdicao } | null = null;
  const limite = AJUSTES_DA_EDICAO.decisoesPorEdicao;

  for (let n = 1; n <= limite; n++) {
    let decisao: DecisaoDaEdicao;
    if (guardada) {
      decisao = guardada;
      guardada = null;
    } else {
      decisao = await chamar<DecisaoDaEdicao>("decidirEdicao", decidirIA.versao, decidirIA.nivel, { tentativa: n, palavras: palavras.length }, () =>
        gerarEstruturado({
          tarefa: "decidirEdicao",
          nivel: decidirIA.nivel,
          effort: decidirIA.esforco,
          schema: decidirIA.schema,
          sistemaEstavel: decidirIA.montarSistemaEstavel(),
          entrada: decidirIA.montarEntrada({
            roteiro: contexto.roteiro,
            marca: { nome: contexto.marca.nome, nomesParaGrafar: contexto.nomes, resumo: contexto.marca.resumo },
            duracaoS: entrada.duracaoS,
            palavras,
            motivosDaDecisaoAnterior: motivos,
          }),
        }),
      );
    }

    const plano = montarPlano({ palavras, energia, decisao });
    if (!plano.ok) {
      motivos = plano.problemas;
      continue;
    }
    const titulo = { texto: decisao.titulo.texto.replace(/\s+/g, " ").trim(), subtitulo: decisao.titulo.subtitulo?.replace(/\s+/g, " ").trim() || null };
    const avisos = limparAvisos(decisao.avisos);
    const resultado: ResultadoDaEdicao = { edl: plano.edl, legenda: plano.legenda, titulo, avisos, tentativas: n, problemas: [], verificadaEm: null };
    ultimo = { decisao, resultado };
    const locais = conferirLocal({ edl: plano.edl, legenda: plano.legenda, titulo, palavras, textoDoRoteiro: contexto.textoDoRoteiro, nomes: contexto.nomes });
    if (locais.length > 0) {
      motivos = locais;
      resultado.problemas = locais;
      continue;
    }

    if (entrada.aoPassarNoCodigo) await entrada.aoPassarNoCodigo(decisao, resultado);
    const verificacao = await chamar<verificarIA.SaidaVerificarEdicao>("verificarEdicao", verificarIA.versao, verificarIA.nivel, { tentativa: n }, () =>
      gerarEstruturado({
        tarefa: "verificarEdicao",
        nivel: verificarIA.nivel,
        effort: verificarIA.esforco,
        schema: verificarIA.schema,
        sistemaEstavel: verificarIA.montarSistemaEstavel(),
        entrada: verificarIA.montarEntrada({
          nomesParaGrafar: contexto.nomes,
          resumoDaMarca: contexto.marca.resumo,
          roteiro: contexto.roteiro,
          blocosDaLegenda: plano.legenda.blocos.map((b) => b.texto),
          titulo,
        }),
      }),
    );
    const reprovou = verificacao.problemas.filter((p) => p.gravidade === "reprova");
    if (reprovou.length === 0) {
      const avisosFinais = limparAvisos([...avisos, ...verificacao.problemas.map((p) => p.descricao)]);
      return {
        estado: "verificado",
        decisao,
        resultado: { ...resultado, avisos: avisosFinais, problemas: [], verificadaEm: entrada.agora.toISOString() },
        decisoes: n,
        problemas: [],
      };
    }
    motivos = reprovou.map((p) => `${p.onde === "titulo" ? "título" : `bloco ${p.bloco ?? "?"} da legenda`}: ${p.descricao}${p.sugestao ? ` (sugestão: ${p.sugestao})` : ""}`);
    resultado.problemas = motivos;
  }

  return {
    estado: "para_revisao",
    decisao: ultimo?.decisao ?? null,
    resultado: ultimo ? { ...ultimo.resultado, problemas: motivos } : null,
    decisoes: limite,
    problemas: motivos,
  };
}
