/**
 * E47 PR 2: a curva de energia do áudio como o banco a guarda (`edicoes.energia`): dB com duas casas, em uma lista simples. Uma janela de 10 ms por número; 3 minutos dão 18 mil números
 * (uns 150 mil caracteres). O bruto não fica guardado depois de 48 horas, então o motor de corte lê isto em vez de refazer a conta.
 */
import type { EnergiaGuardada } from "@/db/schema";

import type { Energia } from "./tipos";

export function energiaParaBanco(energia: Energia): EnergiaGuardada {
  return { db: Array.from(energia.db, (x) => Math.round(x * 100) / 100), duracao: energia.duracao };
}

export function energiaDoBanco(guardada: EnergiaGuardada): Energia {
  return { db: Float32Array.from(guardada.db), duracao: guardada.duracao };
}
