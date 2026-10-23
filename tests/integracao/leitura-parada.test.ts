/**
 * A leitura que não trava (23/10/2026), contra o Postgres real, com o yt-dlp, o ffmpeg, a Groq e o e-mail simulados (nunca chama o YouTube, a Apify nem o proxy de verdade).
 *
 * Achado: no ramo 5, de 3.523 vídeos acima do piso nos últimos 90 dias só 109 tinham análise, porque a transcrição do YouTube parou em 02/10 (o proxy sem tráfego) e ninguém viu por 20 dias.
 * O que se prova aqui, parte por parte: (1) o estado de cada rede parada vai no resumo da rodada e sobrevive à rodada seguinte, com o "desde" da primeira noite; (2) a fila deixa de gastar as
 * vagas com a rede parada e passa a vez para as que funcionam, com uma tentativa de prova por rodada que a traz de volta sozinha; (3) o aviso ao admin sai uma vez por dia; (4) o setor com
 * marca ativa lê mais vídeos por noite e ganha mais tempo, pelos de maior fora da curva.
 */
/* eslint-disable import/order -- vi.mock intercalados com os imports que precisam vir depois deles (mesmo motivo de transcrever.test.ts). */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { clientes, configuracaoAdmin, execucoesJob, nichos, ramosDaConta, user, videos } from "@/db/schema";
import { FILAS } from "@/jobs/fila";

vi.mock("@/jobs/legendas-youtube", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/legendas-youtube")>();
  return { ...original, baixarLegendaYoutube: vi.fn() };
});
vi.mock("@/jobs/audio", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/audio")>();
  return { ...original, baixarAudio: vi.fn(), apagarAudio: vi.fn() };
});
vi.mock("@/jobs/groq-api", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/jobs/groq-api")>();
  return { ...original, transcreverAudio: vi.fn() };
});
vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return {
    ...original,
    config: {
      ...original.config,
      transcricao: { ...original.config.transcricao, groqKey: "chave-de-teste" },
      regras: { ...original.config.regras, transcricoesPorDia: 2, transcricoesPorDiaComMarca: 2 },
    },
  };
});

import { baixarLegendaYoutube, ErroLegendaDoProxy } from "@/jobs/legendas-youtube";
import { apagarAudio, baixarAudio, ErroAudio, ErroAudioDoProxy } from "@/jobs/audio";
import { transcreverAudio } from "@/jobs/groq-api";
import { rodarTranscrever } from "@/jobs/transcrever";
import { config, hojeISO } from "@/lib/config";
import { CHAVE_DO_AVISO_DE_LEITURA, avisarLeituraParada } from "@/servicos/aviso-de-leitura";
import { inicioDoAdmin } from "@/servicos/admin-inicio";
import { estadoAtualDaLeitura, type EstadoDaLeitura } from "@/servicos/leitura-parada";
import { setoresComMarcaAtiva } from "@/servicos/ramos-com-marca";

import { resetarSchema } from "../../scripts/resetar-schema";

const MIN = 60_000;
const DIA_MS = 24 * 60 * MIN;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DIA_MS);

const LEGENDA_LONGA =
  "legenda transcrita do video com bastante detalhe para passar do tamanho minimo exigido " +
  "pelo job, contando a historia inteira do que foi dito do inicio ao fim sem cortar nada, " +
  "com mais uma frase soh para garantir que passa dos duzentos caracteres pedidos no teste.";

const arquivosTemporarios: string[] = [];
function audioDe(bytes = 1_000): string {
  const caminho = join(tmpdir(), `audio-teste-leitura-${Date.now()}-${arquivosTemporarios.length}.mp3`);
  writeFileSync(caminho, Buffer.alloc(bytes));
  arquivosTemporarios.push(caminho);
  return caminho;
}

const SLUG = "leitura-";
const idsDeSetores: number[] = [];
let relogio = 0;
const agora = () => relogio;

async function criarSetor(slug: string): Promise<number> {
  const [setor] = await db().insert(nichos).values({ slug: `${SLUG}${slug}`, nome: `${SLUG}${slug}`, termos: [] }).returning();
  idsDeSetores.push(setor.id);
  return setor.id;
}

/** Vídeos sem dono (o teto de duas por conta não entra), do mais forte ao mais fraco. `youtube` sobe hoje (vem primeiro na fila); `instagram` e `tiktok` só fora da curva (vêm depois). */
async function criarVideos(nichoId: number, plataforma: "youtube" | "tiktok" | "instagram", quantos: number, prefixo: string = plataforma) {
  for (let i = 0; i < quantos; i += 1) {
    await db()
      .insert(videos)
      .values({
        plataforma,
        idExterno: `${prefixo}-${nichoId}-${i}`,
        url: `https://exemplo.invalido/${prefixo}-${nichoId}-${i}`,
        contaId: null,
        nichoId,
        views: 100,
        publicadoEm: plataforma === "youtube" ? diasAtras(3) : diasAtras(10),
        ...(plataforma === "youtube" ? { velocidadeRelativa: String(100 - i) } : { foraDaCurva: String(50 - i) }),
        idioma: "pt",
      });
  }
}

/** O que a rodada anterior deixou no resumo da execução: o estado das redes. */
async function rodadaAnterior(estado: EstadoDaLeitura, quando = diasAtras(1)) {
  await db().insert(execucoesJob).values({ nome: FILAS.transcrever, status: "ok", iniciadoEm: quando, terminadoEm: quando, resumo: { leituraParada: estado } });
}

const parada = (causa: "proxy sem trafego" | "bloqueio" | "sem leitura", desde: Date) => ({ causa, desde: desde.toISOString() });

async function transcritosDo(nichoId: number) {
  const linhas = await db().select().from(videos).where(eq(videos.nichoId, nichoId));
  return linhas.filter((v) => v.transcricao !== null).map((v) => v.idExterno);
}

beforeAll(async () => {
  await resetarSchema(db());
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  vi.mocked(baixarLegendaYoutube).mockReset();
  vi.mocked(baixarAudio).mockReset().mockImplementation(async () => audioDe());
  vi.mocked(apagarAudio).mockReset().mockResolvedValue(undefined);
  vi.mocked(transcreverAudio).mockReset().mockResolvedValue({ texto: "texto transcrito pela groq", idiomaDetectado: "pt", semFala: false });
  relogio = 0;
  config.regras.transcricoesPorDia = 2;
  config.regras.transcricoesPorDiaComMarca = 2;
  await db().execute(sql`delete from pgboss.job where name = ${FILAS.extrairSemFala}`);
});

afterEach(async () => {
  for (const arquivo of arquivosTemporarios.splice(0)) rmSync(arquivo, { force: true });
  if (idsDeSetores.length > 0) {
    await db().delete(ramosDaConta).where(inArray(ramosDaConta.nichoId, idsDeSetores));
    await db().delete(clientes).where(sql`${clientes.nome} like '[teste]%'`);
    await db().delete(videos).where(inArray(videos.nichoId, idsDeSetores));
    await db().delete(nichos).where(inArray(nichos.id, idsDeSetores));
    idsDeSetores.length = 0;
  }
  await db().delete(execucoesJob).where(eq(execucoesJob.nome, FILAS.transcrever));
  await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_AVISO_DE_LEITURA));
  await db().delete(user).where(sql`${user.email} like '%@leitura.teste'`);
  config.regras.transcricoesPorDia = 2;
  config.regras.transcricoesPorDiaComMarca = 2;
});

describe("a fila não trava na rede parada", () => {
  it("com o proxy parado desde a noite anterior, a fila sai sem o YouTube: uma tentativa de prova, e o Instagram ocupa as vagas da noite", async () => {
    const setor = await criarSetor("a");
    // Dez vídeos do YouTube na frente (sobem hoje) e três do Instagram atrás: com o teto de 2 a fila tem 8 posições, e antes só o YouTube cabia nelas.
    await criarVideos(setor, "youtube", 10);
    await criarVideos(setor, "instagram", 3);
    const desde = diasAtras(20);
    await rodadaAnterior({ youtube: parada("proxy sem trafego", desde), tiktok: parada("proxy sem trafego", desde) });
    vi.mocked(baixarLegendaYoutube).mockRejectedValue(new ErroLegendaDoProxy("proxy sem trafego", "proxy sem trafego: a legenda passou pelo proxy e ele recusou"));

    const resumo = await rodarTranscrever();

    expect(baixarLegendaYoutube).toHaveBeenCalledTimes(1);
    expect((resumo.sucessos as Record<string, number>).instagram).toBe(2);
    expect(resumo.transcritosPorGroq).toBe(2);
    expect(await transcritosDo(setor)).toEqual([`instagram-${setor}-0`, `instagram-${setor}-1`]);
    expect(resumo.sondasDeProva).toEqual({ youtube: "continua parada" });
    // A rede continua parada, com o "desde" da primeira noite (20 dias atrás), não o de hoje.
    const estado = resumo.leituraParada as EstadoDaLeitura;
    expect(estado.youtube).toEqual(parada("proxy sem trafego", desde));
    expect(estado.tiktok).toEqual(parada("proxy sem trafego", desde));
    expect(estado.instagram).toBeUndefined();
    // Nada foi marcado como falha dos vídeos do YouTube: o proxy é que falhou.
    const doYoutube = (await db().select().from(videos).where(eq(videos.nichoId, setor))).filter((v) => v.plataforma === "youtube");
    expect(doYoutube.every((v) => v.proximaTentativaTranscricao === null && v.transcricao === null)).toBe(true);
  });

  it("a tentativa de prova funciona: a rede volta na hora, a fila é refeita completa (o YouTube de novo na frente) e o estado fica limpo", async () => {
    const setor = await criarSetor("volta");
    config.regras.transcricoesPorDia = 3;
    await criarVideos(setor, "youtube", 6);
    await criarVideos(setor, "instagram", 2);
    await rodadaAnterior({ youtube: parada("proxy sem trafego", diasAtras(5)), tiktok: parada("proxy sem trafego", diasAtras(5)) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(LEGENDA_LONGA);

    const resumo = await rodarTranscrever();

    // A prova leu o primeiro, e os outros dois das três vagas voltaram ao YouTube (que é quem tem mais prioridade); o Instagram não precisou das vagas.
    expect((resumo.sucessos as Record<string, number>).youtube).toBe(3);
    expect((resumo.sucessos as Record<string, number>).instagram).toBe(0);
    expect(resumo.sondasDeProva).toEqual({ youtube: "voltou" });
    expect(resumo.leituraParada).toEqual({});
    expect(resumo.youtubePausadoMotivo).toBeUndefined();
  });

  it("o proxy que cai no meio da noite, sem aviso de antes: o primeiro erro tira o YouTube da fila e o Instagram, que estava depois dos dez, é alcançado", async () => {
    const setor = await criarSetor("cai");
    await criarVideos(setor, "youtube", 10);
    await criarVideos(setor, "instagram", 3);
    vi.mocked(baixarLegendaYoutube).mockRejectedValue(new ErroLegendaDoProxy("proxy sem trafego", "proxy sem trafego: a legenda passou pelo proxy e ele recusou"));

    const antes = Date.now();
    const resumo = await rodarTranscrever();

    expect(baixarLegendaYoutube).toHaveBeenCalledTimes(1);
    expect((resumo.sucessos as Record<string, number>).instagram).toBe(2);
    const estado = resumo.leituraParada as EstadoDaLeitura;
    expect(estado.youtube?.causa).toBe("proxy sem trafego");
    expect(estado.tiktok?.causa).toBe("proxy sem trafego");
    expect(new Date(estado.youtube!.desde).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    // O resumo antigo continua dizendo o motivo (o cartão da rotina e o Início de antes leem estes campos).
    expect(resumo.youtubePausadoMotivo).toBe("proxy sem trafego");
    expect(resumo.youtubePausado).toBe(true);
  });

  it("o Instagram sem nenhuma leitura boa na rodada (cinco falhas ou mais) fica parado por falta de leitura; a rodada seguinte tenta só um vídeo, e um que lê limpa o estado", async () => {
    const setor = await criarSetor("ig");
    config.regras.transcricoesPorDia = 40;
    await criarVideos(setor, "instagram", 6);
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudio("download falhou"));

    const primeira = await rodarTranscrever();
    const estado1 = primeira.leituraParada as EstadoDaLeitura;
    expect(estado1.instagram?.causa).toBe("sem leitura");
    expect(primeira.falhas).toBe(6);
    await db().insert(execucoesJob).values({ nome: FILAS.transcrever, status: "ok", resumo: primeira });

    // Noite seguinte: vídeos novos; a rede está parada, então só um é tentado de prova (o resto da fila não existe sem ela), e esse lê.
    await criarVideos(setor, "instagram", 5, "ig-novo");
    vi.mocked(baixarAudio).mockReset().mockImplementation(async () => audioDe());
    const segunda = await rodarTranscrever();

    expect(segunda.sondasDeProva).toEqual({ instagram: "voltou" });
    expect(segunda.leituraParada).toEqual({});
    expect((segunda.sucessos as Record<string, number>).instagram).toBe(5);
    expect(estado1.instagram?.desde).toBeTruthy();
  });

  it("bloqueio do YouTube parado e a tentativa de prova barrada de novo: continua parado, com o mesmo 'desde', e só uma tentativa foi gasta", async () => {
    const setor = await criarSetor("bloqueio");
    await criarVideos(setor, "youtube", 6);
    await criarVideos(setor, "instagram", 1);
    const desde = diasAtras(4);
    await rodadaAnterior({ youtube: parada("bloqueio", desde) });
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockImplementation(async (url: string) => {
      if (url.includes("youtube-")) throw new ErroAudio("ERROR: Sign in to confirm you're not a bot");
      return audioDe();
    });

    const resumo = await rodarTranscrever();

    expect((resumo.tentativas as Record<string, number>).youtube).toBe(1);
    expect(resumo.falhasYoutubeBot).toBe(1);
    expect(resumo.sondasDeProva).toEqual({ youtube: "continua parada" });
    expect((resumo.sucessos as Record<string, number>).instagram).toBe(1);
    expect((resumo.leituraParada as EstadoDaLeitura).youtube).toEqual(parada("bloqueio", desde));
  });

  it("proxy parado e a prova falha por culpa do vídeo (privado): o proxy respondeu, então a parada some e o YouTube volta à fila completa", async () => {
    const setor = await criarSetor("respondeu");
    config.regras.transcricoesPorDia = 3;
    await criarVideos(setor, "youtube", 5);
    await rodadaAnterior({ youtube: parada("proxy sem trafego", diasAtras(5)), tiktok: parada("proxy sem trafego", diasAtras(5)) });
    vi.mocked(baixarLegendaYoutube).mockImplementation(async (url: string) => (url.endsWith("-0") ? null : LEGENDA_LONGA));
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudio("video privado ou removido"));

    const resumo = await rodarTranscrever();

    expect(resumo.sondasDeProva).toEqual({ youtube: "voltou" });
    expect((resumo.sucessos as Record<string, number>).youtube).toBe(3);
    expect(resumo.leituraParada).toEqual({});
  });

  it("as redes que o proxy não toca ficam no Instagram da prova: o fora do ar que passou de três seguidos é parada do proxy, não 'sem leitura'", async () => {
    const setor = await criarSetor("fora");
    config.regras.transcricoesPorDia = 40;
    await criarVideos(setor, "youtube", 6);
    vi.mocked(baixarLegendaYoutube).mockResolvedValue(null);
    vi.mocked(baixarAudio).mockRejectedValue(new ErroAudioDoProxy("proxy fora do ar", "proxy fora do ar: nao conectou"));

    const resumo = await rodarTranscrever();

    const estado = resumo.leituraParada as EstadoDaLeitura;
    expect(estado.youtube?.causa).toBe("proxy fora do ar");
    expect(resumo.falhas).toBe(0);
  });
});

describe("o estado lido do banco", () => {
  it("a rodada mais nova que gravou o estado vale; sem nenhuma, vale o resumo antigo do proxy", async () => {
    expect(await estadoAtualDaLeitura()).toEqual({});

    const desde = diasAtras(20);
    await db().insert(execucoesJob).values({ nome: FILAS.transcrever, status: "ok", iniciadoEm: diasAtras(2), resumo: { youtubePausadoMotivo: "proxy sem trafego", proxyPausadoDesde: desde.toISOString() } });
    const antigo = await estadoAtualDaLeitura();
    expect(antigo.youtube).toEqual(parada("proxy sem trafego", desde));
    expect(antigo.tiktok).toEqual(antigo.youtube);

    await db().insert(execucoesJob).values({ nome: FILAS.transcrever, status: "ok", iniciadoEm: diasAtras(1), resumo: { leituraParada: { instagram: parada("sem leitura", diasAtras(1)) } } });
    const novo = await estadoAtualDaLeitura();
    expect(Object.keys(novo)).toEqual(["instagram"]);
  });

  it("o Início do admin mostra o proxy no lugar de sempre e as outras redes na lista nova", async () => {
    const desde = diasAtras(20);
    await rodadaAnterior({ youtube: parada("proxy sem trafego", desde), tiktok: parada("proxy sem trafego", desde), instagram: parada("sem leitura", diasAtras(1)) });

    const inicio = await inicioDoAdmin();

    expect(inicio.atencao.proxy).toEqual({ motivo: "proxy sem trafego", desde });
    expect(inicio.atencao.leituraParada.map((p) => [p.plataforma, p.causa])).toEqual([["instagram", "sem leitura"]]);
  });

  it("tudo lendo: o Início não pede atenção por leitura", async () => {
    await rodadaAnterior({});
    const inicio = await inicioDoAdmin();
    expect(inicio.atencao.proxy).toBeNull();
    expect(inicio.atencao.leituraParada).toEqual([]);
  });
});

describe("o aviso ao admin", () => {
  const estadoParado: EstadoDaLeitura = { youtube: parada("proxy sem trafego", diasAtras(20)), tiktok: parada("proxy sem trafego", diasAtras(20)) };

  async function criarAdmin(email = "admin@leitura.teste", extra: { banido?: boolean; papel?: string } = {}) {
    await db().insert(user).values({ id: `leitura-${email}`, name: "Admin", email, role: extra.papel ?? "admin", banned: extra.banido ?? false });
  }

  it("manda um e-mail por admin, uma vez por dia: o segundo aviso do mesmo dia não sai", async () => {
    await criarAdmin();
    await criarAdmin("outro@leitura.teste");
    await criarAdmin("cliente@leitura.teste", { papel: "cliente" });
    await criarAdmin("banido@leitura.teste", { banido: true });
    const enviar = vi.fn().mockResolvedValue(undefined);

    const primeiro = await avisarLeituraParada(estadoParado, new Date(), enviar);
    const segundo = await avisarLeituraParada(estadoParado, new Date(), enviar);

    expect(primeiro).toEqual({ enviado: true, destinatarios: 2 });
    expect(segundo).toEqual({ enviado: false, motivo: "ja enviado hoje" });
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls.map((c) => c[0].para).sort()).toEqual(["admin@leitura.teste", "outro@leitura.teste"]);
    const { assunto, html } = enviar.mock.calls[0][0];
    expect(assunto).toBe("A leitura de vídeos parou: YouTube e TikTok");
    expect(html).toContain("o proxy está sem tráfego");
    expect(html).toContain("há 20 dias");
    expect(html).toContain("Recarregue o pacote do proxy");
  });

  it("no dia seguinte avisa de novo enquanto a parada durar; quando tudo volta, a trava some e uma nova parada avisa outra vez", async () => {
    await criarAdmin();
    const enviar = vi.fn().mockResolvedValue(undefined);
    const hoje = new Date();
    const amanha = new Date(hoje.getTime() + DIA_MS);

    expect((await avisarLeituraParada(estadoParado, hoje, enviar)).enviado).toBe(true);
    expect((await avisarLeituraParada(estadoParado, amanha, enviar)).enviado).toBe(true);
    expect(enviar).toHaveBeenCalledTimes(2);

    expect(await avisarLeituraParada({}, amanha, enviar)).toEqual({ enviado: false, motivo: "nada parado" });
    const [chave] = await db().select().from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_AVISO_DE_LEITURA));
    expect(chave).toBeUndefined();
    expect((await avisarLeituraParada(estadoParado, amanha, enviar)).enviado).toBe(true);
  });

  it("falha de envio não grava a trava (tenta de novo amanhã, ou na próxima rodada) e sem admin nada é enviado", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("resend fora do ar"));
    expect(await avisarLeituraParada(estadoParado, new Date(), enviar)).toEqual({ enviado: false, motivo: "sem destinatario" });

    await criarAdmin();
    expect(await avisarLeituraParada(estadoParado, new Date(), enviar)).toEqual({ enviado: false, motivo: "falha no envio", destinatarios: 0 });
    const [chave] = await db().select().from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_AVISO_DE_LEITURA));
    expect(chave).toBeUndefined();
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("a rodada global avisa (e diz isso no resumo); a segunda do mesmo dia não repete; a de um setor só não avisa", async () => {
    await criarAdmin();
    const setor = await criarSetor("aviso");
    await criarVideos(setor, "youtube", 4);
    vi.mocked(baixarLegendaYoutube).mockRejectedValue(new ErroLegendaDoProxy("proxy sem trafego", "proxy sem trafego: a legenda passou pelo proxy e ele recusou"));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const parcial = await rodarTranscrever(setor);
    expect(parcial.avisoDeLeitura).toBeUndefined();

    const global = await rodarTranscrever();
    const repetida = await rodarTranscrever();
    const enviados = log.mock.calls.filter((c) => String(c[0]).startsWith("[e-mail simulado]"));
    log.mockRestore();

    expect(global.avisoDeLeitura).toEqual({ enviado: true, destinatarios: 1 });
    expect(repetida.avisoDeLeitura).toEqual({ enviado: false, motivo: "ja enviado hoje" });
    expect(enviados).toHaveLength(1);
    expect(String(enviados[0][0])).toContain("admin@leitura.teste");
    const [chave] = await db().select().from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_AVISO_DE_LEITURA));
    expect(chave.valor).toBe(hojeISO());
  });
});

describe("o teto de leitura por noite, por ramo com marca ativa", () => {
  it("o ramo com marca ativa lê o teto maior pelos de maior fora da curva, e o ramo sem marca fica no padrão", async () => {
    config.regras.transcricoesPorDia = 1;
    config.regras.transcricoesPorDiaComMarca = 3;
    const comMarca = await criarSetor("com-marca");
    const semMarca = await criarSetor("sem-marca");
    const marcaInativa = await criarSetor("marca-inativa");
    const alternativo = await criarSetor("alternativo");
    for (const setor of [comMarca, semMarca, marcaInativa, alternativo]) await criarVideos(setor, "instagram", 6);
    await db().insert(clientes).values({ nome: "[teste] Marca ativa", nichoId: comMarca, ativo: true });
    await db().insert(clientes).values({ nome: "[teste] Marca desligada", nichoId: marcaInativa, ativo: false });
    const [outra] = await db().insert(clientes).values({ nome: "[teste] Marca com ramo alternativo", ativo: true }).returning();
    await db().insert(ramosDaConta).values({ clienteId: outra.id, nichoId: alternativo });

    expect([...(await setoresComMarcaAtiva())].sort()).toEqual([comMarca, alternativo].sort());
    const resumo = await rodarTranscrever();

    expect(resumo.tetoPorSetor).toEqual({
      [`${SLUG}com-marca`]: 3,
      [`${SLUG}sem-marca`]: 1,
      [`${SLUG}marca-inativa`]: 1,
      [`${SLUG}alternativo`]: 3,
    });
    // Os de maior fora da curva primeiro: o 0 vale 50, o 1 vale 49, o 2 vale 48...
    expect(await transcritosDo(comMarca)).toEqual([`instagram-${comMarca}-0`, `instagram-${comMarca}-1`, `instagram-${comMarca}-2`]);
    expect(await transcritosDo(semMarca)).toEqual([`instagram-${semMarca}-0`]);
    expect(await transcritosDo(marcaInativa)).toEqual([`instagram-${marcaInativa}-0`]);
    expect((await transcritosDo(alternativo)).length).toBe(3);
    expect((resumo.sucessos as Record<string, number>).instagram).toBe(8);
  });

  it("o ramo com marca ativa também ganha mais tempo: com 25 min no padrão e 45 min com marca, a 10 min por vídeo, lê 5 e o outro lê 3", async () => {
    config.regras.transcricoesPorDia = 10;
    config.regras.transcricoesPorDiaComMarca = 10;
    const comMarca = await criarSetor("tempo-com");
    const semMarca = await criarSetor("tempo-sem");
    await criarVideos(comMarca, "youtube", 8);
    await criarVideos(semMarca, "youtube", 8);
    await db().insert(clientes).values({ nome: "[teste] Marca do tempo", nichoId: comMarca, ativo: true });
    vi.mocked(baixarLegendaYoutube).mockImplementation(async () => {
      relogio += 10 * MIN;
      return LEGENDA_LONGA;
    });

    const resumo = await rodarTranscrever(undefined, { agora, orcamentoPorSetorMs: 25 * MIN, orcamentoPorSetorComMarcaMs: 45 * MIN, orcamentoTotalMs: 600 * MIN });

    expect((await transcritosDo(comMarca)).length).toBe(5);
    expect((await transcritosDo(semMarca)).length).toBe(3);
    expect(resumo.setoresParadosPeloOrcamento).toEqual([
      { slug: `${SLUG}tempo-com`, ficaramParaDepois: 3 },
      { slug: `${SLUG}tempo-sem`, ficaramParaDepois: 5 },
    ]);
  });
});
