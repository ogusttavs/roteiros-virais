/**
 * Processo do worker (etapa 6): `npm run worker`. Sobe o pg-boss, garante as
 * filas, registra os agendamentos e fica processando. Um job que falha
 * registra em `execucoes_job` e nao derruba o processo (`executarComRegistro`
 * cuida disso; so relanca quando o pg-boss deve mesmo tentar de novo).
 */
import "dotenv/config";

import { agendarTudo, listarAgendamentos } from "./agenda";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { executarComRegistro } from "./execucoes";
import { boss, FILAS, garantirFilas } from "./fila";

async function main(): Promise<void> {
  await boss().start();
  await garantirFilas();
  await agendarTudo();

  await boss().work(FILAS.coletaYoutube, async () => {
    await executarComRegistro(FILAS.coletaYoutube, rodarColetaYoutube);
  });
  await boss().work(FILAS.coletaNoticias, async () => {
    await executarComRegistro(FILAS.coletaNoticias, rodarColetaNoticias);
  });

  console.log("worker no ar.");
  console.log(listarAgendamentos());
}

main().catch((erro) => {
  console.error("worker nao subiu:", erro);
  process.exit(1);
});
