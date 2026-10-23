/**
 * Compara a prova do Tema livre antes e depois da busca por significado (E17 parte 1, 23/10/2026), contra um banco de brinquedo semeado na hora (18 vídeos inventados de um
 * setor de odontologia, `tests/fixtures/busca/busca-por-significado.ts`), sem chave real: `AI_PROVIDER` precisa ser `mock` e o banco precisa ser local. Cria um setor próprio e o apaga
 * no fim. Uso: `npm run comparar:busca`. A coluna "depois" é a busca por significado SEM o modelo barato (que só se mede com chave real); os temas que ainda ficam
 * sem prova são os que dependem dele.
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, getPool } from "../src/db";
import { nichos, videos } from "../src/db/schema";
import { config } from "../src/lib/config";
import { evidenciaParaTema } from "../src/servicos/pesquisa";
import { TEMAS_DE_COMPARACAO, VIDEOS_DE_BUSCA, semearBuscaPorSignificado } from "../tests/fixtures/busca/busca-por-significado";

import { verificarAmbienteSeguro } from "./resetar-schema";

async function main(): Promise<void> {
  if (config.ia.provedor !== "mock") throw new Error("Este script so roda com AI_PROVIDER=mock.");
  verificarAmbienteSeguro();

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: `comparacao-busca-${Date.now()}`, nome: "Comparacao da busca", termos: [] })
    .returning();
  try {
    const ids = await semearBuscaPorSignificado(nicho.id, "cmp");
    const chaveDe = new Map([...ids].map(([chave, id]) => [id, chave]));
    const rotular = (lista: { id: number }[]) => lista.map((v) => chaveDe.get(v.id) ?? `?${v.id}`);

    console.log(`Banco semeado: ${VIDEOS_DE_BUSCA.length} videos de um setor de odontologia (inventados). Limite 8 por tema.\n`);
    console.log("| # | Tema | Antes (busca de sempre) | Depois (busca por significado) |");
    console.log("|---|---|---|---|");
    let indice = 0;
    for (const caso of TEMAS_DE_COMPARACAO) {
      indice += 1;
      config.busca.porSignificado = false;
      const antes = rotular(await evidenciaParaTema(nicho.id, caso.tema, 8));
      config.busca.porSignificado = true;
      const depois = rotular(await evidenciaParaTema(nicho.id, caso.tema, 8));
      const celula = (lista: string[]) => (lista.length > 0 ? lista.join(", ") : "nada");
      console.log(`| ${indice} | ${caso.tema} | ${celula(antes)} | ${celula(depois)} |`);
    }
  } finally {
    await db().delete(videos).where(eq(videos.nichoId, nicho.id));
    await db().delete(nichos).where(eq(nichos.id, nicho.id));
    await getPool().end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
