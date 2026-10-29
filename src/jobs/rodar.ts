/**
 * Roda um job uma vez, direto (sem passar pelo worker nem pela fila):
 * `npm run job -- <nome>`. `npm run job -- listar` so imprime os
 * agendamentos. Usado nos testes com chave real desta etapa.
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { perfisCitados, type Plataforma } from "@/db/schema";

import { listarAgendamentos } from "./agenda";
import { rodarAnalisarPerfil } from "./analisar-perfil";
import { rodarAnalisarVisual } from "./analisar-visual";
import { rodarAprenderCliente } from "./aprender-cliente";
import { rodarColetaApify } from "./coleta-apify";
import { rodarColetaMeioDia } from "./coleta-meio-dia";
import { rodarColetaNoticias } from "./coleta-noticias";
import { rodarColetaYoutube } from "./coleta-youtube";
import { rodarComentariosSemana } from "./comentarios-semana";
import { rodarContasBase } from "./contas-base";
import { rodarCurvaCliente } from "./curva-cliente";
import { rodarDescobertaInstagram } from "./descoberta-instagram";
import { rodarEmailAcompanhamento } from "./email-acompanhamento";
import { rodarEntenderMarca } from "./entender-marca";
import { executarComRegistro } from "./execucoes";
import { rodarExtrair } from "./extrair";
import { rodarExtrairAgora } from "./extrair-agora";
import { rodarExtrairColeta } from "./extrair-coleta";
import { rodarExtrairSemFala } from "./extrair-sem-fala";
import { rodarFaxinaDeContas } from "./faxina-de-contas";
import { rodarFaxinaDasVersoes } from "./faxina-versoes";
import { FILAS } from "./fila";
import { rodarFiltroDeNoticias } from "./filtrar-noticias";
import { rodarGuardarCapas } from "./guardar-capas";
import { rodarLembrete } from "./lembrete";
import { rodarLerLongos } from "./ler-longos";
import { rodarLimparEdicoes } from "./limpar-edicoes";
import { rodarMetaContas } from "./meta-contas";
import { rodarMetaHashtags } from "./meta-hashtags";
import { rodarModeloNicho } from "./modelo-nicho";
import { rodarPesquisaDeSetor } from "./pesquisa-de-setor";
import { rodarPesquisaDoFoco } from "./pesquisa-do-foco";
import { rodarPesquisaNaHora } from "./pesquisa-na-hora";
import { rodarPontuar } from "./pontuar";
import { rodarPublicarInstagram } from "./publicar-instagram";
import { rodarRenovarContasLigadas } from "./renovar-contas-ligadas";
import { rodarTemasDoDia } from "./temas-do-dia";
import { rodarTendenciasBrasil } from "./tendencias-brasil";
import { rodarTranscrever } from "./transcrever";
import { rodarTranscreverEdicao } from "./transcrever-edicao";
import { rodarVigilancia } from "./vigilancia";

/**
 * Toda entrada embrulhada numa arrow function, mesmo as que ignoram o
 * argumento (ajuste 1 da revisão do PR #36): `executarComRegistro` chama
 * `tarefa(execucao.id)`, e uma referência direta a uma função com
 * `nichoId?: number` como primeiro parâmetro (`rodarColetaYoutube`,
 * `rodarColetaNoticias`, `rodarMetaContas`, `rodarMetaHashtags`,
 * `rodarDescobertaInstagram`) recebia o id da execução ali, filtrava por um
 * nicho que não existe e terminava "ok" sem processar nada; o `typecheck`
 * não pega porque uma função com menos parâmetros é atribuível a um tipo
 * com mais. Só `rodarColetaApify` e `rodarColetaMeioDia` de fato usam o id.
 * Exportada para o teste (`rodar.test.ts`) chamar cada entrada direto.
 */
export const TAREFAS: Record<string, (execucaoId: number) => Promise<Record<string, unknown>>> = {
  [FILAS.coletaYoutube]: () => rodarColetaYoutube(),
  [FILAS.coletaApify]: (execucaoId) => rodarColetaApify(undefined, execucaoId),
  [FILAS.coletaMeioDia]: (execucaoId) => rodarColetaMeioDia(execucaoId),
  [FILAS.coletaNoticias]: () => rodarColetaNoticias(),
  /** Fix de 22/10/2026: com um número na linha de comando, só aquele ramo; sem, todo ramo com marca ativa. */
  [FILAS.filtrarNoticias]: () => {
    const nichoIdArg = process.argv[3];
    return rodarFiltroDeNoticias(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  [FILAS.tendenciasBrasil]: () => rodarTendenciasBrasil(),
  [FILAS.contasBase]: () => rodarContasBase(),
  [FILAS.metaContas]: () => rodarMetaContas(),
  [FILAS.metaHashtags]: () => rodarMetaHashtags(),
  [FILAS.descobertaInstagram]: () => rodarDescobertaInstagram(),
  [FILAS.guardarCapas]: () => rodarGuardarCapas(),
  [FILAS.pontuar]: () => rodarPontuar(),
  [FILAS.vigilancia]: () => rodarVigilancia(),
  /** Faxina das contas fora do setor: com um número na linha de comando, só aquele ramo; sem, todo ramo ativo (o cron semanal). */
  [FILAS.faxinaDeContas]: () => {
    const nichoIdArg = process.argv[3];
    return rodarFaxinaDeContas(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  [FILAS.transcrever]: () => {
    const nichoIdArg = process.argv[3];
    return rodarTranscrever(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  [FILAS.extrair]: () => rodarExtrair(),
  [FILAS.extrairColeta]: () => rodarExtrairColeta(),
  /**
   * M2, item 0a2 da revisão do PR #73: faltava aqui, então `npm run job -- extrair-agora`
   * respondia "job desconhecido" (achado do Fable em produção, no deploy da M1). `nichoId`
   * opcional na linha de comando, mesma ideia do `clienteId` de `aprender-cliente`: sem
   * argumento, roda para todo setor novo; com um número, só aquele setor.
   */
  [FILAS.extrairAgora]: () => {
    const nichoIdArg = process.argv[3];
    return rodarExtrairAgora(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  [FILAS.analisarVisual]: () => rodarAnalisarVisual(),
  /** E28: com um número na linha de comando, só aquele setor; sem, todo setor ativo (o cron semanal). */
  [FILAS.comentariosSemana]: () => {
    const nichoIdArg = process.argv[3];
    return rodarComentariosSemana(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  /** E52 (PR 2): com um número na linha de comando, só aquele setor; sem, todo setor ativo (o cron semanal). */
  [FILAS.lerLongos]: () => {
    const nichoIdArg = process.argv[3];
    return rodarLerLongos(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  [FILAS.extrairSemFala]: () => {
    const nichoIdArg = process.argv[3];
    return rodarExtrairSemFala(nichoIdArg === undefined || nichoIdArg.startsWith("--") ? undefined : Number(nichoIdArg), process.argv.includes("--so-ficha"));
  },
  [FILAS.modeloNicho]: () => rodarModeloNicho(),
  /**
   * R1, item 0: `npm run job -- temas-do-dia <nichoId> --refazer` refaz um setor só, mesmo que
   * já tenha tema hoje (sem `--refazer`, pula quem já tem, igual a sempre); sem `nichoId`
   * nenhum, refaz todos (o comportamento do cron). A segurança de nunca piorar o que já está lá
   * é da própria `rodarTemasDoDia`/`podeSobrescreverTemasDoDia`, não deste despacho.
   */
  [FILAS.temasDoDia]: () => {
    const nichoIdArg = process.argv.slice(3).find((arg) => /^\d+$/.test(arg));
    const forcar = process.argv.includes("--refazer");
    // E61 PR 2: `--conta=<clienteId>` refaz só os temas por foco dessa conta (precisa do `nichoId` dela antes).
    const contaArg = process.argv.find((arg) => /^--conta=\d+$/.test(arg));
    return rodarTemasDoDia(nichoIdArg === undefined ? undefined : Number(nichoIdArg), { forcar, clienteId: contaArg === undefined ? undefined : Number(contaArg.slice("--conta=".length)) });
  },
  /** E61 PR 3: `npm run job -- pesquisa-do-foco [<clienteId>]` pesquisa o foco de uma conta, ou de todas as que estão em uso. */
  [FILAS.pesquisaDoFoco]: () => {
    const clienteIdArg = process.argv[3];
    return rodarPesquisaDoFoco({ clienteId: clienteIdArg === undefined ? undefined : Number(clienteIdArg) });
  },
  [FILAS.pesquisaDeSetor]: () => {
    const nichoIdArg = process.argv[3];
    return rodarPesquisaDeSetor(nichoIdArg === undefined ? undefined : Number(nichoIdArg));
  },
  [FILAS.lembrete]: () => rodarLembrete(),
  [FILAS.curvaCliente]: () => rodarCurvaCliente(),
  [FILAS.emailAcompanhamento]: () => rodarEmailAcompanhamento(),
  [FILAS.faxinaVersoes]: () => rodarFaxinaDasVersoes(),
  [FILAS.renovarContasLigadas]: () => rodarRenovarContasLigadas(),
  /** Por evento (E54): `npm run job -- pesquisa-na-hora <pesquisaId>` roda uma pesquisa já criada, na hora (busca paga com a chave real). */
  [FILAS.pesquisaNaHora]: () => rodarPesquisaNaHora(Number(process.argv[3])),
  /** Por evento (E56): `npm run job -- publicar-instagram <publicacaoId>` confere (e publica, se o vídeo estiver pronto) uma publicação já criada. */
  [FILAS.publicarInstagram]: () => rodarPublicarInstagram(Number(process.argv[3])),
  /** Por evento (E47 PR 2): `npm run job -- transcrever-edicao <edicaoId>` transcreve uma edição já guardada (usa a chave da Groq do ambiente). */
  [FILAS.transcreverEdicao]: () => rodarTranscreverEdicao(Number(process.argv[3])),
  /** E47 PR 2: apaga o que passou do prazo de guarda e o que não tem dono no volume de edição. */
  [FILAS.limparEdicoes]: () => rodarLimparEdicoes(),
  /**
   * Por evento, nao por horario, sempre para um cliente so (E27, parte 2,
   * item 2): sem um "todos os clientes" que faca sentido, o disparo manual
   * pede o id na linha de comando, `npm run job -- aprender-cliente <id>`.
   */
  [FILAS.aprenderCliente]: () => {
    const clienteId = Number(process.argv[3]);
    if (!Number.isFinite(clienteId)) {
      throw new Error("uso: npm run job -- aprender-cliente <clienteId>");
    }
    return rodarAprenderCliente(clienteId);
  },
  /**
   * E38, partes 2 e 3: mesmo raciocínio do `aprender-cliente`, só para um perfil por vez. Acha
   * sozinho se o handle é um citado (`perfisCitados`) ou a própria marca, pelo que está gravado.
   */
  [FILAS.analisarPerfil]: async () => {
    const clienteId = Number(process.argv[3]);
    const rede = process.argv[4] as Plataforma | undefined;
    const handle = process.argv[5];
    if (!Number.isFinite(clienteId) || !rede || !handle) {
      throw new Error("uso: npm run job -- analisar-perfil <clienteId> <youtube|instagram|tiktok> <handle>");
    }
    const [citado] = await db()
      .select()
      .from(perfisCitados)
      .where(eq(perfisCitados.clienteId, clienteId))
      .then((linhas) => linhas.filter((l) => l.rede === rede && l.handle === handle));
    return rodarAnalisarPerfil(
      citado
        ? { clienteId, perfilCitadoId: citado.id, origem: "citado", tipoCitado: citado.tipo, rede, handle }
        : { clienteId, perfilCitadoId: null, origem: "propria_marca", tipoCitado: null, rede, handle },
    );
  },
  /**
   * E38 PR 2: sem argumento roda o despachante (o mesmo do cron diário, só enfileira quem precisa);
   * `npm run job -- entender-marca <clienteId> [--forcar]` lê uma marca na hora (o Fable roda assim
   * para as marcas que já existem, com o sim do Gustavo), direto, sem passar pela fila.
   */
  [FILAS.entenderMarca]: () => {
    // Todos os argumentos depois do nome do job, em qualquer ordem: o id da marca (só dígitos) e `--forcar`. Qualquer outra coisa,
    // mais de um id, ou `--forcar` sem id é erro de digitação: cair no despachante enfileiraria até 25 leituras de marcas que
    // ninguém pediu, sem o sim do Gustavo que a leitura manual exige.
    const argumentos = process.argv.slice(3);
    const forcar = argumentos.includes("--forcar");
    const ids = argumentos.filter((argumento) => /^\d+$/.test(argumento));
    const estranho = argumentos.find((argumento) => argumento !== "--forcar" && !/^\d+$/.test(argumento));
    if (estranho !== undefined || ids.length > 1 || (forcar && ids.length === 0)) {
      throw new Error(
        `uso: npm run job -- entender-marca [<clienteId> [--forcar]]; recebi "${argumentos.join(" ")}" (um id de marca, só dígitos, e --forcar só com id).`,
      );
    }
    return rodarEntenderMarca(ids.length === 1 ? { clienteId: Number(ids[0]), origem: "manual", forcar } : null);
  },
};

async function main(): Promise<void> {
  const nome = process.argv[2];

  if (!nome || nome === "listar") {
    console.log(listarAgendamentos());
    return;
  }

  const tarefa = TAREFAS[nome];
  if (!tarefa) {
    console.error(`job desconhecido: "${nome}". Use um de: ${Object.keys(TAREFAS).join(", ")}, ou "listar".`);
    process.exitCode = 1;
    return;
  }

  const resultado = await executarComRegistro(nome, tarefa);
  if (resultado.status === "erro") {
    console.error(`${nome} terminou com erro: ${resultado.erro}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${nome} rodou:`, JSON.stringify(resultado.resumo, null, 2));
}

/**
 * So dispara ao rodar `tsx src/jobs/rodar.ts` direto (`npm run job`), nunca
 * quando `rodar.test.ts` importa `TAREFAS` (mesmo raciocinio de
 * `scripts/avaliar-briefing.ts`, "require.main e o script que foi chamado
 * na linha de comando").
 */
if (require.main === module) {
  main().catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
