"use client";

import { useEffect, useState } from "react";

/** Quanto a folha que sai fica na tela, em milissegundos: `--duracao-folha-sai` (260 ms) com uma folga. Com "reduzir movimento" a saída é mais curta e só sobra um quadro invisível. */
const SAIDA_MS = 300;

/**
 * Passo 16 do Opus, capítulo 4 (as folhas): a folha não some de uma vez, ela sai com a curva de entrada em 260 ms e o véu clareia junto. Por isso `aberto` falso
 * não desmonta na hora: `montada` continua verdadeira durante a saída e `saindo` põe a classe que roda a animação. Uma regra só para toda folha do painel.
 */
export function useFolhaAnimada(aberto: boolean): { montada: boolean; saindo: boolean } {
  const [montada, setMontada] = useState(aberto);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    if (aberto) {
      setMontada(true);
      setSaindo(false);
      return;
    }
    if (!montada) return;
    setSaindo(true);
    const espera = setTimeout(() => {
      setMontada(false);
      setSaindo(false);
    }, SAIDA_MS);
    return () => clearTimeout(espera);
  }, [aberto, montada]);

  // `aberto` virou verdadeiro e o efeito ainda não rodou: já renderiza aberta, sem um quadro vazio.
  return { montada: aberto || montada, saindo: !aberto && saindo };
}
