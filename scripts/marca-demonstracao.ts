/**
 * npm run marca:demonstracao -- <arquivo.json> [--simular] [--convidar] [--mostrar-senhas]
 *
 * Cadastra uma marca inteira pelo servidor, sem passar pelo navegador (T84): a marca do catalogo de ramos, tipo e plano, a cortesia, as pessoas com acesso, os
 * campos do "Comecar", as respostas do briefing (cada uma avaliada pela IA de verdade, igual a tela), o foco da marca (E61) e a cor da marca. Usa so as funcoes de
 * servico que o aplicativo ja usa (`criarMarcaDoCatalogo`, `definirCortesia`, `darAcesso`, `salvarDadosFixosComPedido`, `salvarRascunho`, `avaliarResposta`,
 * `escreverFoco`, `definirCorMarca`); nenhum SQL a mao alem de achar a marca pelo nome.
 *
 * Idempotente: marca com o mesmo nome (sem diferenciar maiusculas) ja existe, nao cria outra; quem ja tem acesso fica como esta; resposta igual a que esta salva e
 * ja avaliada nao e reavaliada (nao gasta IA). `--simular` mostra o que faria sem gravar nada e sem chamar a IA.
 *
 * Gente sem conta: criar a conta manda o e-mail de convite (`darAcesso`). Por isso o script so faz isso com `--convidar`; sem a opcao, se alguem da lista nao tem
 * conta, ele para ANTES de gravar qualquer coisa e avisa. Quem ja tem conta so ganha a marca, sem e-mail. A senha provisoria so aparece com `--mostrar-senhas`.
 *
 * Rodar dentro do container do worker, como o `admin:criar` (deploy/README.md). O JSON vai para dentro do container por volume ou por `docker compose run -v`.
 */
import { readFileSync } from "node:fs";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { corValida } from "@/carrossel/modelos";
import { dadosFixosDoBriefing, perguntaPorId, perguntasDoBriefing } from "@/config/briefing";
import { ramoPorSlug } from "@/config/ramos";
import { db, getPool } from "@/db";
import { clientes, membrosMarca, user, type Cliente, type PlanoMarca, type TipoMarca } from "@/db/schema";
import { config } from "@/lib/config";
import { avaliarResposta, lerBriefing, salvarRascunho } from "@/servicos/briefing";
import {
  criarMarcaDoCatalogo,
  darAcesso,
  definirCorMarca,
  definirCortesia,
  definirPlano,
  ErroCliente,
  salvarDadosFixosComPedido,
} from "@/servicos/clientes";
import { escreverFoco, estadoDoFoco, limparFoco } from "@/servicos/foco-da-conta";

const perfisSchema = z.object({ instagram: z.string().optional(), tiktok: z.string().optional(), youtube: z.string().optional() }).strict();

/** Os campos do Comecar, com os nomes da tela: `objetivo` e o "O que voce quer com os videos" (a persona), `onde` e o "Onde estao os seus clientes?". */
const comecarSchema = z
  .object({
    onde: z.enum(["brasil", "local", "outro_pais", "mais_de_um_pais"]),
    regiao: z.string().optional(),
    pais: z.string().optional(),
    paises: z.string().optional(),
    site: z.string().optional(),
    objetivo: z.enum(["negocio", "criador", "conhecido", "negocios"]),
    perfis: perfisSchema.optional(),
    quemGrava: z.enum(["propria_pessoa", "pessoa_e_equipe", "equipe", "outra_pessoa"]).optional(),
  })
  .strict();

export const entradaSchema = z
  .object({
    marca: z.string().trim().min(1).max(80),
    ramo: z.string().trim().min(1),
    tipo: z.enum(["negocio", "pessoa"]).default("negocio"),
    plano: z.enum(["padrao", "sem_limite"]).default("padrao"),
    cortesia: z.boolean().default(false),
    pessoas: z.array(z.object({ nome: z.string().trim().min(1), email: z.string().trim().toLowerCase().email() }).strict()).default([]),
    comecar: comecarSchema.optional(),
    /** O texto de cada resposta, pelo id da pergunta (p1 a p12). */
    briefing: z.record(z.string(), z.string().trim().min(1)).default({}),
    foco: z.string().optional(),
    cor: z.string().optional(),
  })
  .strict();

export type EntradaMarca = z.infer<typeof entradaSchema>;

export type OpcoesDoScript = { simular: boolean; convidar: boolean; mostrarSenhas: boolean };

export type RelatorioMarca = {
  marcaId: number | null;
  marcaJaExistia: boolean;
  linhas: string[];
  notas: { id: string; nota: number | null; situacao: "avaliada agora" | "ja avaliada" | "sera avaliada" }[];
  notaGeral: number | null;
  briefingCompleto: boolean;
  faltando: string[];
  /** Quem foi convidado agora com a senha provisoria (so preenchido com `mostrarSenhas`). */
  senhas: { email: string; senha: string }[];
  precisouEsperarOEnfileiramento: boolean;
};

/** Para o script parar antes de gravar qualquer coisa (entrada invalida, gente sem conta sem `--convidar`). */
export class ErroDoScript extends Error {}

export function lerEntrada(texto: string): EntradaMarca {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroDoScript("o arquivo nao e um JSON valido.");
  }
  const lido = entradaSchema.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues.map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`).join("\n");
    throw new ErroDoScript(`o JSON nao confere com o formato esperado:\n${problemas}`);
  }
  return lido.data;
}

/** Tudo o que da para conferir sem tocar no banco; um problema aqui para o script antes de gravar. */
export function validarEntrada(entrada: EntradaMarca): string[] {
  const problemas: string[] = [];
  if (!ramoPorSlug(entrada.ramo)) problemas.push(`ramo "${entrada.ramo}" nao esta no catalogo de ramos (src/config/ramos.ts).`);
  for (const id of Object.keys(entrada.briefing)) {
    if (!perguntaPorId(id, entrada.tipo)) problemas.push(`briefing: a pergunta "${id}" nao existe para o tipo ${entrada.tipo}.`);
  }
  if (entrada.cor !== undefined && !corValida(entrada.cor)) problemas.push(`cor "${entrada.cor}" precisa ser no formato #rrggbb.`);
  if (entrada.foco !== undefined && entrada.foco.trim() !== "") {
    const limpo = limparFoco(entrada.foco);
    if (limpo.length < 10) problemas.push("foco: texto curto demais.");
  }
  const c = entrada.comecar;
  if (c) {
    const opcoesDePersona = dadosFixosDoBriefing(entrada.tipo).persona.opcoes.map((o) => o.valor);
    if (!opcoesDePersona.includes(c.objetivo)) problemas.push(`comecar.objetivo "${c.objetivo}" nao existe para o tipo ${entrada.tipo} (opcoes: ${opcoesDePersona.join(", ")}).`);
    if (c.onde === "local" && !c.regiao?.trim()) problemas.push("comecar.regiao: escreva a cidade ou regiao (onde = local).");
    if (c.onde === "outro_pais" && !c.pais?.trim()) problemas.push("comecar.pais: escreva o pais (onde = outro_pais).");
    if (c.onde === "mais_de_um_pais" && !c.paises?.trim()) problemas.push("comecar.paises: escreva quais paises (onde = mais_de_um_pais).");
  }
  const emails = new Set<string>();
  for (const p of entrada.pessoas) {
    if (emails.has(p.email)) problemas.push(`pessoas: o e-mail ${p.email} aparece duas vezes.`);
    emails.add(p.email);
  }
  return problemas;
}

async function acharMarcaPeloNome(nome: string): Promise<Cliente | null> {
  const [achada] = await db()
    .select()
    .from(clientes)
    .where(sql`lower(trim(${clientes.nome})) = ${nome.trim().toLowerCase()}`)
    .limit(2);
  return achada ?? null;
}

async function marcasComOMesmoNome(nome: string): Promise<number> {
  const linhas = await db()
    .select({ id: clientes.id })
    .from(clientes)
    .where(sql`lower(trim(${clientes.nome})) = ${nome.trim().toLowerCase()}`);
  return linhas.length;
}

async function contaExiste(email: string): Promise<boolean> {
  const [achada] = await db().select({ id: user.id }).from(user).where(eq(user.email, email));
  return Boolean(achada);
}

async function jaTemAcesso(clienteId: number, email: string): Promise<boolean> {
  const [achada] = await db()
    .select({ id: membrosMarca.id })
    .from(membrosMarca)
    .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
    .where(and(eq(membrosMarca.clienteId, clienteId), eq(user.email, email)));
  return Boolean(achada);
}

export async function cadastrarMarca(entrada: EntradaMarca, opcoes: OpcoesDoScript): Promise<RelatorioMarca> {
  const relatorio: RelatorioMarca = {
    marcaId: null,
    marcaJaExistia: false,
    linhas: [],
    notas: [],
    notaGeral: null,
    briefingCompleto: false,
    faltando: [],
    senhas: [],
    precisouEsperarOEnfileiramento: false,
  };
  const dizer = (linha: string) => relatorio.linhas.push((opcoes.simular ? "[simulado] " : "") + linha);

  const problemas = validarEntrada(entrada);
  if (problemas.length > 0) throw new ErroDoScript(`a entrada tem problemas, nada foi gravado:\n${problemas.map((p) => `  ${p}`).join("\n")}`);

  if ((await marcasComOMesmoNome(entrada.marca)) > 1) {
    throw new ErroDoScript(`ha mais de uma marca chamada "${entrada.marca}"; o script nao sabe qual usar. Nada foi gravado.`);
  }
  const existente = await acharMarcaPeloNome(entrada.marca);

  // Antes de gravar qualquer coisa: gente sem conta so entra com --convidar (criar a conta manda o e-mail de convite).
  const semConta: string[] = [];
  for (const pessoa of entrada.pessoas) {
    const tem = existente ? await jaTemAcesso(existente.id, pessoa.email) : false;
    if (!tem && !(await contaExiste(pessoa.email))) semConta.push(pessoa.email);
  }
  if (semConta.length > 0 && !opcoes.convidar && !opcoes.simular) {
    throw new ErroDoScript(
      `estas pessoas ainda nao tem conta e criar a conta manda o e-mail de convite: ${semConta.join(", ")}. Rode de novo com --convidar para criar e convidar, ou tire-as da lista. Nada foi gravado.`,
    );
  }

  // 1. A marca.
  let marca: Cliente;
  if (existente) {
    marca = existente;
    relatorio.marcaJaExistia = true;
    dizer(`marca ja existe (id ${marca.id}); nao cria outra.`);
    if (marca.tipo !== entrada.tipo) dizer(`AVISO: a marca e do tipo ${marca.tipo} e o arquivo pede ${entrada.tipo}; o tipo nao e trocado (trocar apaga o briefing).`);
  } else if (opcoes.simular) {
    dizer(`criaria a marca "${entrada.marca}" no ramo ${entrada.ramo} (tipo ${entrada.tipo}, plano ${entrada.plano}).`);
    marca = null as unknown as Cliente;
  } else {
    marca = await criarMarcaDoCatalogo({ nome: entrada.marca, ramoSlug: entrada.ramo, tipo: entrada.tipo as TipoMarca, plano: entrada.plano as PlanoMarca });
    dizer(`marca criada (id ${marca.id}).`);
  }
  relatorio.marcaId = marca?.id ?? null;
  const tipoDaMarca: TipoMarca = marca?.tipo ?? (entrada.tipo as TipoMarca);

  // 2. Plano e cortesia.
  if (!marca || marca.plano !== entrada.plano) {
    if (marca && !opcoes.simular) await definirPlano(marca.id, entrada.plano as PlanoMarca);
    if (marca) dizer(`plano ${entrada.plano}.`);
  }
  if (!marca || marca.cortesia !== entrada.cortesia) {
    if (marca && !opcoes.simular) await definirCortesia(marca.id, entrada.cortesia);
    dizer(`cortesia ${entrada.cortesia ? "ligada" : "desligada"}.`);
  }

  // 3. Pessoas com acesso.
  for (const pessoa of entrada.pessoas) {
    if (marca && (await jaTemAcesso(marca.id, pessoa.email))) {
      dizer(`${pessoa.email}: ja tem acesso.`);
      continue;
    }
    const temConta = await contaExiste(pessoa.email);
    if (opcoes.simular || !marca) {
      dizer(`${pessoa.email}: ${temConta ? "daria acesso (a conta ja existe, sem e-mail)" : "criaria a conta e mandaria o e-mail de convite"}.`);
      continue;
    }
    try {
      const resultado = await darAcesso(marca.id, pessoa.nome, pessoa.email);
      if (resultado.tipo === "jaTinhaLogin") {
        dizer(`${pessoa.email}: acesso dado a conta que ja existia (${resultado.nome}); nenhum e-mail enviado.`);
      } else {
        dizer(`${pessoa.email}: conta criada e e-mail de convite mandado.`);
        if (opcoes.mostrarSenhas) relatorio.senhas.push({ email: pessoa.email, senha: resultado.senha });
        else dizer(`${pessoa.email}: senha provisoria nao mostrada (use --mostrar-senhas, ou "Gerar senha nova" no admin).`);
      }
    } catch (erro) {
      if (!(erro instanceof ErroCliente)) throw erro;
      relatorio.faltando.push(`acesso de ${pessoa.email}: ${erro.message}`);
      dizer(`${pessoa.email}: NAO deu acesso (${erro.message}).`);
    }
  }

  // 4. O "Comecar".
  if (entrada.comecar) {
    const c = entrada.comecar;
    const dadosBrutos = {
      nome: entrada.marca,
      alcance: c.onde,
      regiao: c.regiao,
      pais: c.pais,
      paises: c.paises,
      site: c.site,
      ramo: entrada.ramo,
      persona: c.objetivo,
      perfis: c.perfis,
      quemGrava: c.quemGrava,
    };
    if (opcoes.simular || !marca) dizer("gravaria os campos do Comecar (onde, site, objetivo, perfis, quem aparece).");
    else {
      const { limiteDeRamosNovos } = await salvarDadosFixosComPedido(marca.id, dadosBrutos);
      dizer("campos do Comecar gravados.");
      if (limiteDeRamosNovos) relatorio.faltando.push("ramo: o teto de ramos novos do dia segurou; o pedido de ramo ficou aberto para o admin.");
    }
  } else {
    relatorio.faltando.push("campos do Comecar (comecar) nao vieram no arquivo.");
  }

  // 5. Briefing: cada resposta salva e avaliada como na tela; igual e ja avaliada, nao gasta IA.
  const perguntas = perguntasDoBriefing(tipoDaMarca);
  const briefingAtual = marca ? await lerBriefing(marca.id) : null;
  let avaliouAlguma = false;
  for (const pergunta of perguntas) {
    const texto = entrada.briefing[pergunta.id];
    if (texto === undefined) {
      const jaTem = briefingAtual?.respostas[pergunta.id];
      if (!jaTem) relatorio.faltando.push(`briefing ${pergunta.id}: sem resposta.`);
      else relatorio.notas.push({ id: pergunta.id, nota: briefingAtual?.avaliacoes[pergunta.id]?.nota ?? null, situacao: "ja avaliada" });
      continue;
    }
    const guardada = briefingAtual?.avaliacoes[pergunta.id];
    if (briefingAtual?.respostas[pergunta.id] === texto && guardada) {
      relatorio.notas.push({ id: pergunta.id, nota: guardada.nota, situacao: "ja avaliada" });
      continue;
    }
    if (opcoes.simular || !marca) {
      relatorio.notas.push({ id: pergunta.id, nota: null, situacao: "sera avaliada" });
      continue;
    }
    await salvarRascunho(marca.id, pergunta.id, texto, tipoDaMarca);
    const resultado = await avaliarResposta(marca.id, pergunta.id, texto, tipoDaMarca);
    avaliouAlguma = true;
    relatorio.notas.push({ id: pergunta.id, nota: resultado.avaliacao.nota, situacao: "avaliada agora" });
  }
  relatorio.precisouEsperarOEnfileiramento = avaliouAlguma;
  if (marca) {
    const fresco = await lerBriefing(marca.id);
    if (fresco) {
      relatorio.notaGeral = fresco.notaGeral === null ? null : Number(fresco.notaGeral);
      relatorio.briefingCompleto = fresco.completo;
    }
  }
  if (!opcoes.simular && marca && !relatorio.briefingCompleto) {
    relatorio.faltando.push(`briefing: a nota geral ainda nao chegou a ${config.regras.notaMinimaBriefing} (o briefing so libera o painel nessa nota).`);
  }

  // 6. O foco da marca (E61): o texto escrito fica confirmado na hora, como na tela.
  if (entrada.foco !== undefined && entrada.foco.trim() !== "") {
    const limpo = limparFoco(entrada.foco);
    const atual = marca ? (await db().select().from(clientes).where(eq(clientes.id, marca.id)))[0] : undefined;
    const estado = atual ? estadoDoFoco(atual) : { estado: "sem" as const };
    if (estado.estado === "confirmado" && estado.texto === limpo) dizer("foco ja estava como no arquivo.");
    else if (opcoes.simular || !marca) dizer("gravaria o foco da marca como confirmado.");
    else {
      await escreverFoco(marca.id, entrada.foco);
      dizer("foco gravado e confirmado.");
    }
  } else {
    relatorio.faltando.push("foco da marca (foco) nao veio no arquivo.");
  }

  // 7. A cor da marca.
  if (entrada.cor !== undefined) {
    if (marca?.corMarca === entrada.cor) dizer("cor ja estava como no arquivo.");
    else if (opcoes.simular || !marca) dizer(`poria a cor ${entrada.cor}.`);
    else {
      await definirCorMarca(marca.id, entrada.cor);
      dizer(`cor ${entrada.cor} gravada.`);
    }
  }

  return relatorio;
}

export function formatarRelatorio(r: RelatorioMarca): string {
  const saida: string[] = [];
  saida.push(`marca: ${r.marcaId === null ? "(ainda nao criada)" : `id ${r.marcaId}${r.marcaJaExistia ? " (ja existia)" : ""}`}`);
  saida.push(...r.linhas.map((l) => `  ${l}`));
  saida.push("notas do briefing:");
  if (r.notas.length === 0) saida.push("  (nenhuma resposta)");
  for (const n of r.notas) saida.push(`  ${n.id}: ${n.nota === null ? "-" : n.nota.toFixed(1)} (${n.situacao})`);
  saida.push(`nota do conjunto: ${r.notaGeral === null ? "-" : r.notaGeral.toFixed(2)} (briefing ${r.briefingCompleto ? "completo" : "incompleto"})`);
  saida.push("o que ficou faltando:");
  if (r.faltando.length === 0) saida.push("  nada");
  for (const f of r.faltando) saida.push(`  ${f}`);
  for (const s of r.senhas) saida.push(`senha provisoria de ${s.email}: ${s.senha}`);
  return saida.join("\n");
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const opcoes: OpcoesDoScript = {
    simular: argumentos.includes("--simular"),
    convidar: argumentos.includes("--convidar"),
    mostrarSenhas: argumentos.includes("--mostrar-senhas"),
  };
  const caminho = argumentos.find((a) => !a.startsWith("--"));
  if (!caminho) throw new ErroDoScript("uso: npm run marca:demonstracao -- <arquivo.json> [--simular] [--convidar] [--mostrar-senhas]");

  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    throw new ErroDoScript(`nao consegui ler o arquivo ${caminho}.`);
  }
  const relatorio = await cadastrarMarca(lerEntrada(texto), opcoes);
  console.log(formatarRelatorio(relatorio));
  // A leitura do site e das redes e enfileirada sem esperar quando o briefing fica completo; da um instante para ela sair antes de fechar o banco.
  if (relatorio.precisouEsperarOEnfileiramento) await new Promise((resolver) => setTimeout(resolver, 3000));
}

/** O Vitest importa este arquivo para testar `cadastrarMarca`; sem a guarda, o import ja rodaria `main()` (mesmo motivo de `criar-admin.ts`). */
if (!process.env.VITEST) {
  main()
    .then(async () => {
      await getPool().end();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e instanceof ErroDoScript ? `Nao foi possivel: ${e.message}` : e);
      await getPool().end();
      process.exit(1);
    });
}
