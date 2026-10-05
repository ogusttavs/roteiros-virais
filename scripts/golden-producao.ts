/**
 * Os golden sets pelo MESMO caminho de produção (pedido do Fable, 04/10/2026): até agora os scripts mediam uma passada só, e em produção (`gerarComVerificacao`, `ia/verificador.ts`) há duas
 * tentativas: a segunda leva o motivo da reprovação ("A tentativa anterior foi reprovada. Motivo: ... Corrija isso.") e só reprovar nas duas vira `ErroIA` para a pessoa. Aqui cada etapa
 * continua em lote (ou `--direto`, `golden-lote.ts`): a 1ª tentativa de todos os casos; a conferência local (com a correção mecânica de travessão, emoji e "voce/nao/tambem/ja" sem acento, igual à
 * produção) e a do `verificarTexto` com as fontes; e só os reprovados refazem, com o motivo, na 2ª tentativa. O número que decide o deploy é "reprovado nas duas".
 */
import { motivoDaConferencia, type SaidaVerificarTexto } from "../src/ia/prompts/verificarTexto";
import type { ResultadoGeracao } from "../src/ia/tipos";
import { MARCADOR_SEGUNDA_TENTATIVA, corrigirMecanicamente, ehMotivoMecanico } from "../src/ia/verificador";

import { custoDoResultado, gerarVariosOuErro, type PedidoGolden } from "./golden-lote";

export type VerificacaoLocal = { aprovado: boolean; motivos: string[] };

export type CasoEmProducao<T> = {
  /** O pedido da geração (a 1ª tentativa; a 2ª acrescenta o motivo por cima, como `gerarComVerificacao`). */
  pedido: () => PedidoGolden<T>;
  /** A conferência local da saída. `tentativa` 2 não confere a faixa de duração nem a ficha "guardem", como a produção. */
  local: (dados: T, tentativa: 1 | 2) => VerificacaoLocal;
  /** Os campos de texto que o `verificarTexto` confere. */
  campos: (dados: T) => Record<string, string>;
  /** O pedido do `verificarTexto` (com as fontes dos fatos) para estes campos. */
  pedidoVerificador: (campos: Record<string, string>) => PedidoGolden<SaidaVerificarTexto>;
};

export type ResultadoEmProducao<T> = {
  /** A geração da última tentativa (com a correção mecânica aplicada, se houve); `null` quando a chamada falhou. */
  gerada: ResultadoGeracao<T> | null;
  /** Chamada da geração ou do verificador que falhou (rede, lote com erro): o caso sai da conta. */
  falhou: Error | null;
  /** A conferência final: aprovada em alguma tentativa, ou reprovada nas duas (em produção, `ErroIA`). */
  verificacao: VerificacaoLocal;
  tentativas: 1 | 2;
  reprovouNa1a: boolean;
  motivosDa1a: string[];
  /** Soma do custo de todas as chamadas do caso (geração e verificador, nas duas tentativas). */
  custoUsd: number;
};

type Passada<T> = { gerada: ResultadoGeracao<T> | null; falhou: Error | null; verificacao: VerificacaoLocal; custoUsd: number };

export async function rodarComoEmProducao<T>(opcoes: {
  rotulo: string;
  /** O lembrete de acentuação, sempre a última linha da entrada nas duas tentativas (`gerarComVerificacao`, `lembreteFinal`). */
  lembreteFinal?: string;
  casos: CasoEmProducao<T>[];
}): Promise<ResultadoEmProducao<T>[]> {
  const { rotulo, lembreteFinal, casos } = opcoes;

  async function passar(tentativa: 1 | 2, indices: number[], motivos: Map<number, string[]>): Promise<Map<number, Passada<T>>> {
    const base = indices.map((i) => casos[i].pedido());
    const pedidos = base.map((pedido, posicao) => {
      const motivo = motivos.get(indices[posicao]);
      const comMotivo = tentativa === 2 && motivo ? `${pedido.entrada}\n\n${MARCADOR_SEGUNDA_TENTATIVA} Motivo: ${motivo.join("; ")}. Corrija isso.` : pedido.entrada;
      return { ...pedido, entrada: lembreteFinal ? `${comMotivo}\n\n${lembreteFinal}` : comMotivo };
    });
    const geradas = await gerarVariosOuErro(pedidos, `${rotulo}, ${tentativa}ª tentativa`);

    const saida = new Map<number, Passada<T>>();
    const camposDoCaso = new Map<number, Record<string, string>>();
    indices.forEach((i, posicao) => {
      const g = geradas[posicao];
      if (g instanceof Error) {
        saida.set(i, { gerada: null, falhou: g, verificacao: { aprovado: false, motivos: [] }, custoUsd: 0 });
        return;
      }
      let dados = g.dados;
      let local = casos[i].local(dados, tentativa);
      // Igual à produção (M5b, achado 10): reprovação só mecânica (travessão, emoji, "voce" sem acento) é corrigida por código, sem gastar outra tentativa.
      if (!local.aprovado && local.motivos.every(ehMotivoMecanico)) {
        const corrigidos = corrigirMecanicamente(dados);
        const localCorrigido = casos[i].local(corrigidos, tentativa);
        if (localCorrigido.aprovado) {
          dados = corrigidos;
          local = localCorrigido;
        }
      }
      camposDoCaso.set(i, casos[i].campos(dados));
      saida.set(i, { gerada: { ...g, dados }, falhou: null, verificacao: local, custoUsd: custoDoResultado(pedidos[posicao].nivel, g) });
    });

    // O `verificarTexto` só nos que a conferência local aprovou (e que têm algum texto), num lote só.
    const paraVerificar = [...saida.entries()].flatMap(([i, p]) => (p.verificacao.aprovado && Object.keys(camposDoCaso.get(i) ?? {}).length > 0 ? [i] : []));
    const pedidosVerificador = paraVerificar.map((i) => casos[i].pedidoVerificador(camposDoCaso.get(i)!));
    const respostas = await gerarVariosOuErro(pedidosVerificador, `verificador (${rotulo}, ${tentativa}ª tentativa)`);
    paraVerificar.forEach((i, posicao) => {
      const resposta = respostas[posicao];
      const p = saida.get(i)!;
      if (resposta instanceof Error) {
        saida.set(i, { ...p, falhou: resposta });
        return;
      }
      const custoUsd = p.custoUsd + custoDoResultado(pedidosVerificador[posicao].nivel, resposta);
      const aprovado = resposta.dados.aprovado;
      // Reprovando por fato, o motivo carrega o fato e a fonte mais próxima (`motivoDaConferencia`).
      const motivo = aprovado ? [] : [motivoDaConferencia(resposta.dados)];
      saida.set(i, { ...p, custoUsd, verificacao: { aprovado, motivos: motivo } });
    });
    return saida;
  }

  const todos = casos.map((_, i) => i);
  const primeira = await passar(1, todos, new Map());
  const reprovados = todos.filter((i) => {
    const p = primeira.get(i)!;
    return !p.falhou && !p.verificacao.aprovado;
  });
  const motivos1 = new Map(reprovados.map((i) => [i, primeira.get(i)!.verificacao.motivos]));
  const segunda = reprovados.length > 0 ? await passar(2, reprovados, motivos1) : new Map<number, Passada<T>>();

  return todos.map((i): ResultadoEmProducao<T> => {
    const p1 = primeira.get(i)!;
    const p2 = segunda.get(i);
    const final = p2 ?? p1;
    return {
      gerada: final.gerada ?? p1.gerada,
      falhou: final.falhou ?? p1.falhou,
      verificacao: final.verificacao,
      tentativas: p2 ? 2 : 1,
      reprovouNa1a: Boolean(motivos1.get(i)),
      motivosDa1a: motivos1.get(i) ?? [],
      custoUsd: p1.custoUsd + (p2?.custoUsd ?? 0),
    };
  });
}


/** O resumo que decide o deploy: quantos reprovaram na 1ª tentativa e quantos nas duas (em produção, `ErroIA`). */
export function resumirProducao<T>(producao: ResultadoEmProducao<T>[]): { reprovadosNa1a: number; reprovadosNasDuas: number; falhos: number } {
  return {
    reprovadosNa1a: producao.filter((p) => !p.falhou && p.reprovouNa1a).length,
    reprovadosNasDuas: producao.filter((p) => !p.falhou && !p.verificacao.aprovado).length,
    falhos: producao.filter((p) => p.falhou).length,
  };
}

export function linhaDoResumo(total: number, r: { reprovadosNa1a: number; reprovadosNasDuas: number }): string {
  return `reprovado na 1ª tentativa: ${r.reprovadosNa1a} de ${total}, reprovado nas duas (ErroIA em produção): ${r.reprovadosNasDuas} de ${total}`;
}
