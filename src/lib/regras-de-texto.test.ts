import { describe, expect, it } from "vitest";

import { encontrarJargaoDoMotor, encontrarProblemas, JARGAO_DO_MOTOR } from "./regras-de-texto";

/**
 * 23/10/2026 (prova com chave): as palavras que o motor usa por dentro e o dono do negócio não entende. Uma frase de exemplo por entrada da lista;
 * `encontrarJargaoDoMotor` reprova cada uma, e as palavras comuns ("banco", "base") só reprovam quando falam dos dados do motor.
 */
const FRASES: Record<string, string[]> = {
  "banco do setor": ["O banco do seu setor cobre esse assunto.", "Procurei no banco de vídeos.", "Está no nosso banco.", "No banco de dados não achei."],
  base: ["A base do seu setor não tem isso.", "Pela nossa base, ninguém fez.", "A base de dados mostra."],
  "fora da curva": ["Três vídeos fora da curva.", "Nenhum vídeo passou da curva."],
  mediana: ["Rendeu 3 vezes a mediana da conta."],
  nicho: ["Isso é comum no seu nicho.", "Os nichos parecidos."],
  gancho: ["O gancho é forte.", "Dois ganchos diferentes."],
  "elemento que prende": ["Falta um elemento que prende no começo."],
  evidência: ["Sem evidência, não dá para saber.", "Tem evidencia de sobra.", "As evidências apontam."],
};

describe("encontrarJargaoDoMotor", () => {
  it("cada palavra da lista tem frase de exemplo, e cada frase reprova com a troca na mensagem", () => {
    expect(Object.keys(FRASES).sort()).toEqual(JARGAO_DO_MOTOR.map((i) => i.palavra).sort());
    for (const item of JARGAO_DO_MOTOR) {
      for (const frase of FRASES[item.palavra]) {
        const motivos = encontrarJargaoDoMotor(frase);
        expect(motivos.length, frase).toBeGreaterThan(0);
        expect(motivos.join(" "), frase).toContain(item.usar);
        expect(motivos[0]).toMatch(/^jargao /);
      }
    }
  });

  it("não pega as palavras comuns fora do sentido do motor", () => {
    for (const frase of [
      "Passe no banco antes de gravar.",
      "Com base no que você disse, grave de manhã.",
      "Uma base sólida de clientes fiéis.",
      "Vídeos do seu ramo sobre limpeza muito acima do normal da conta.",
      "O começo do vídeo prende quem está assistindo.",
    ]) {
      expect(encontrarJargaoDoMotor(frase), frase).toEqual([]);
    }
  });

  it("fica de fora de encontrarProblemas: gancho e fora da curva seguem permitidos nos outros textos", () => {
    expect(encontrarProblemas("o gancho do vídeo, fora da curva, no nicho")).toEqual([]);
  });
});
