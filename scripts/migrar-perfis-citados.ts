/**
 * Migra os @ que já estiverem escritos nas respostas de P12 (V12c, item 7, a
 * E37b) para `perfis_citados`, sem apagar nada do texto original (a
 * resposta de P12 continua exatamente como estava). Idempotente:
 * `perfis_citados` tem único por cliente, tipo, rede e handle
 * (`onConflictDoNothing` em `adicionarPerfilCitado`), então rodar o script
 * duas vezes não duplica nada.
 *
 * Limitação conhecida, para quem revisar: o enunciado de P12 pede, na mesma
 * frase de texto livre, tanto "perfis que admira" quanto "concorrentes
 * diretos", sem marcar qual é qual; e um "@fulano" solto não diz em qual
 * rede ele está. Este script extrai toda menção com @ do texto e grava
 * como tipo "admira" na rede "instagram" (a leitura mais comum de um "@"
 * solto em português); mover para "concorrente" ou trocar a rede é trabalho
 * de revisão manual, pelo admin, depois.
 *
 * `npm run migrar:perfis-citados`.
 */
import { isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { briefings } from "@/db/schema";
import { adicionarPerfilCitado } from "@/servicos/perfis-citados";

/** Letras, números, ponto e underscore: o que as três redes aceitam em handle, sem o @ em si. */
const REGEX_ARROBA = /@([a-zA-Z0-9._]{2,})/g;

export type ResultadoMigracao = {
  briefingsComP12: number;
  handlesEncontrados: number;
  handlesUnicosProcessados: number;
  erros: { clienteId: number; handle: string; motivo: string }[];
};

export async function migrarPerfisCitados(): Promise<ResultadoMigracao> {
  const linhas = await db()
    .select({ clienteId: briefings.clienteId, respostas: briefings.respostas })
    .from(briefings)
    .where(isNotNull(briefings.respostas));

  const resultado: ResultadoMigracao = {
    briefingsComP12: 0,
    handlesEncontrados: 0,
    handlesUnicosProcessados: 0,
    erros: [],
  };

  for (const linha of linhas) {
    const respostaP12 = linha.respostas.p12;
    if (!respostaP12) continue;

    const handles = [...respostaP12.matchAll(REGEX_ARROBA)].map((m) => m[1]);
    if (handles.length === 0) continue;

    resultado.briefingsComP12 += 1;
    resultado.handlesEncontrados += handles.length;

    for (const handle of new Set(handles)) {
      resultado.handlesUnicosProcessados += 1;
      try {
        await adicionarPerfilCitado(linha.clienteId, "admira", { rede: "instagram", handle });
      } catch (erro) {
        resultado.erros.push({
          clienteId: linha.clienteId,
          handle,
          motivo: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
  }

  return resultado;
}

if (require.main === module) {
  migrarPerfisCitados()
    .then((resultado) => {
      console.log(JSON.stringify(resultado, null, 2));
      process.exit(0);
    })
    .catch((erro) => {
      console.error(erro);
      process.exit(1);
    });
}
