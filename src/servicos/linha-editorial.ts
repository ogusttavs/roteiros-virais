/**
 * Aviso da linha editorial (briefing-e-rubricas.md, seção 5; etapa 10,
 * decisão 4 do `PROXIMO.md`): janela dos últimos 15 roteiros gravados ou
 * postados, comparada com a mistura de referência por persona. Função pura,
 * sem tocar banco: `temasParaCliente` (`src/servicos/temas.ts`) busca o
 * histórico e usa o que esta função devolve.
 *
 * `fraseAvisoLinhaEditorial`, no fim do arquivo, monta o texto que o
 * cliente lê. Fica aqui, fora de `src/textos/` (que o `checar-texto`
 * varre), pelo mesmo motivo de `src/ia/enums.ts`: os nomes internos do
 * objetivo (alcance, engajamento, conversao) são também o jargão proibido
 * na lista de `src/lib/regras-de-texto.ts`, e apareceriam como identificador
 * de código mesmo sem virar texto de tela. `linha-editorial.test.ts` cobre
 * a frase com `encontrarProblemas` para não perder a rede de segurança.
 */
import type { Objetivo, Persona } from "@/db/schema";

const JANELA = 15;
const MINIMO_PARA_AVISAR = 5;
const ULTIMOS_PARA_ZERADO = 5;

const OBJETIVOS: Objetivo[] = ["alcance", "engajamento", "conversao"];

const MISTURA_REFERENCIA: Record<Persona, Record<Objetivo, number>> = {
  negocio: { alcance: 0.4, engajamento: 0.3, conversao: 0.3 },
  criador: { alcance: 0.5, engajamento: 0.35, conversao: 0.15 },
};

export type AvisoLinhaEditorial = {
  /** O objetivo que está abaixo do esperado e deve puxar o primeiro tema do dia. */
  objetivoEmFalta: Objetivo;
  contagemEmFalta: number;
  /** O objetivo mais frequente na janela, para a frase comparar os dois. */
  maisComum: Objetivo;
  contagemMaisComum: number;
  totalNaJanela: number;
};

/**
 * `historico` é o objetivo de cada roteiro gravado ou postado, do mais
 * recente para o mais antigo; só os últimos 15 contam. Com menos de 5, não
 * avisa nada (dado de menos para significar algo).
 */
export function avisoLinhaEditorial(historico: Objetivo[], persona: Persona): AvisoLinhaEditorial | null {
  const janela = historico.slice(0, JANELA);
  if (janela.length < MINIMO_PARA_AVISAR) return null;

  const referencia = MISTURA_REFERENCIA[persona];
  const contagens: Record<Objetivo, number> = { alcance: 0, engajamento: 0, conversao: 0 };
  for (const objetivo of janela) contagens[objetivo] += 1;

  const ultimosCinco = janela.slice(0, ULTIMOS_PARA_ZERADO);

  let objetivoEmFalta: Objetivo | null = null;
  let piorRazao = Infinity;

  for (const objetivo of OBJETIVOS) {
    const parteReal = contagens[objetivo] / janela.length;
    const zeradoRecente = !ultimosCinco.includes(objetivo);
    const abaixoDaMetade = parteReal < referencia[objetivo] / 2;
    if (!zeradoRecente && !abaixoDaMetade) continue;

    const razao = parteReal / referencia[objetivo];
    if (razao < piorRazao) {
      piorRazao = razao;
      objetivoEmFalta = objetivo;
    }
  }

  if (!objetivoEmFalta) return null;

  const maisComum = OBJETIVOS.reduce((a, b) => (contagens[b] > contagens[a] ? b : a));
  if (maisComum === objetivoEmFalta) return null;

  return {
    objetivoEmFalta,
    contagemEmFalta: contagens[objetivoEmFalta],
    maisComum,
    contagemMaisComum: contagens[maisComum],
    totalNaJanela: janela.length,
  };
}

const ROTULO_HISTORICO: Record<Objetivo, string> = {
  alcance: "para te conhecerem",
  engajamento: "para lembrarem de você",
  conversao: "para te chamarem para comprar",
};

const ROTULO_PUXA: Record<Objetivo, string> = {
  alcance: "o lado de te conhecerem",
  engajamento: "o lado de lembrarem de você",
  conversao: "o lado de fechar",
};

/**
 * `reordenou` diz se um dos três temas do dia de fato puxa para o objetivo
 * em falta (nesse caso ele é movido para o primeiro lugar, e a frase diz
 * isso); sem um tema assim entre os três, a frase para no fato do
 * histórico, sem prometer uma reordenação que não aconteceu.
 */
export function fraseAvisoLinhaEditorial(aviso: AvisoLinhaEditorial, reordenou: boolean): string {
  const base = `dos seus últimos ${aviso.totalNaJanela} vídeos, ${aviso.contagemMaisComum} foram ${ROTULO_HISTORICO[aviso.maisComum]} e só ${aviso.contagemEmFalta} ${ROTULO_HISTORICO[aviso.objetivoEmFalta]}`;

  return reordenou ? `${base}; hoje o tema puxa para ${ROTULO_PUXA[aviso.objetivoEmFalta]}` : base;
}
