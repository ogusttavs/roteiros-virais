import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizarVideoTiktok } from "@/servicos/normalizadores/tiktok";

import {
  argumentosLeituraTiktok,
  ErroYtdlpTiktok,
  itemTiktokDoYtdlp,
  lerTiktokPorYtdlp,
  motivoParaTodaARodada,
  PAUSA_MAX_MS,
  PAUSA_MIN_MS,
  pausaEntreLeiturasTiktok,
} from "./tiktok-ytdlp";

/** Dois JSONs de `yt-dlp --dump-json` de vídeos reais do TikTok (estudo de 27/10/2026), reduzidos aos campos úteis e com conta, ids e links trocados por exemplos. */
const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "tiktok-ytdlp-video.json"), "utf8")) as {
  comMetricasAltas: Record<string, unknown>;
  comMetricasZeradas: Record<string, unknown>;
};
const URL_DO_VIDEO = "https://www.tiktok.com/@x/video/7600000000000000001";

describe("itemTiktokDoYtdlp: o JSON do yt-dlp no formato da Apify", () => {
  it("mapeia visualizações, curtidas, comentários, data, duração, legenda, autor e música", () => {
    const item = itemTiktokDoYtdlp(FIXTURE.comMetricasAltas, URL_DO_VIDEO)!;
    expect(item.id).toBe("7600000000000000001");
    expect(item.webVideoUrl).toBe("https://www.tiktok.com/@conta_exemplo/video/7600000000000000001");
    expect(item.playCount).toBe(44800);
    expect(item.diggCount).toBe(3797);
    expect(item.commentCount).toBe(25);
    expect(item.createTimeISO).toBe(new Date(1792861551 * 1000).toISOString());
    expect(item.videoMeta?.duration).toBe(63);
    expect(item.text).toBe("¿Por qué los coches aceleran tanto? . . #coches #autos #carros");
    expect(item.authorMeta).toEqual({ name: "conta_exemplo", nickName: "Conta Exemplo" });
    expect(item.musicMeta).toEqual({ musicName: "sonido original", musicAuthor: "Conta Exemplo" });
  });

  it("traz compartilhamentos e salvamentos, que a Apify não trazia", () => {
    const item = itemTiktokDoYtdlp(FIXTURE.comMetricasAltas, URL_DO_VIDEO) as Record<string, unknown>;
    expect(item.shareCount).toBe(24);
    expect(item.collectCount).toBe(268);
  });

  it("seguidores não vêm por URL: sem authorMeta.fans, e a conta fica com seguidores nulos (a gravação mantém o último valor conhecido)", () => {
    const item = itemTiktokDoYtdlp(FIXTURE.comMetricasAltas, URL_DO_VIDEO)!;
    expect(item.authorMeta).not.toHaveProperty("fans");
    const normalizado = normalizarVideoTiktok(item)!;
    expect(normalizado.conta.seguidores).toBeNull();
    expect(normalizado.conta.handle).toBe("conta_exemplo");
    expect(normalizado.video.views).toBe(44800);
    expect(normalizado.video.comentarios).toBe(25);
    expect(normalizado.audio).toEqual({ id: undefined, nome: "sonido original", autor: "Conta Exemplo", original: undefined });
  });

  it("zero é zero (vídeo novo, sem nada ainda), e o que o TikTok não deu vira ausente, não zero inventado", () => {
    const item = itemTiktokDoYtdlp({ ...FIXTURE.comMetricasZeradas, comment_count: null }, URL_DO_VIDEO)!;
    expect(item.playCount).toBe(1588);
    expect(item.diggCount).toBe(21);
    expect((item as Record<string, unknown>).shareCount).toBe(0);
    expect(item.commentCount).toBeUndefined();
  });

  it("sem timestamp, usa o upload_date à meia-noite UTC", () => {
    const item = itemTiktokDoYtdlp({ ...FIXTURE.comMetricasAltas, timestamp: null, upload_date: "20261024" }, URL_DO_VIDEO)!;
    expect(item.createTimeISO).toBe("2026-10-24T00:00:00.000Z");
  });

  it("usa a url pedida quando o JSON não traz webpage_url, e a legenda cai para o título", () => {
    const item = itemTiktokDoYtdlp({ ...FIXTURE.comMetricasAltas, webpage_url: undefined, description: "", title: "so o titulo" }, URL_DO_VIDEO)!;
    expect(item.webVideoUrl).toBe(URL_DO_VIDEO);
    expect(item.text).toBe("so o titulo");
  });

  it("devolve null para o que não serve: sem id, sem conta, não objeto", () => {
    expect(itemTiktokDoYtdlp({ ...FIXTURE.comMetricasAltas, id: undefined, display_id: undefined }, URL_DO_VIDEO)).toBeNull();
    expect(itemTiktokDoYtdlp({ ...FIXTURE.comMetricasAltas, uploader: undefined }, URL_DO_VIDEO)).toBeNull();
    expect(itemTiktokDoYtdlp("<html>", URL_DO_VIDEO)).toBeNull();
    expect(itemTiktokDoYtdlp(null, URL_DO_VIDEO)).toBeNull();
    expect(itemTiktokDoYtdlp([], URL_DO_VIDEO)).toBeNull();
  });
});

describe("lerTiktokPorYtdlp, com um processo simulado", () => {
  const falhaCom = (stderr: string) => async () => {
    throw Object.assign(new Error("Command failed: yt-dlp --proxy http://usuario:SENHA@proxy:8080 ..."), { stderr });
  };

  it("monta os argumentos como o YouTube: sem baixar, JSON na saída, o proxy do ambiente, a url por último", async () => {
    let args: string[] = [];
    await lerTiktokPorYtdlp(URL_DO_VIDEO, {
      executar: async (_comando, argumentos) => {
        args = argumentos;
        return { stdout: JSON.stringify(FIXTURE.comMetricasAltas), stderr: "" };
      },
    });
    expect(args).toEqual(expect.arrayContaining(["--skip-download", "--dump-json"]));
    expect(args[args.length - 1]).toBe(URL_DO_VIDEO);
    expect(args).toEqual(argumentosLeituraTiktok(URL_DO_VIDEO));
  });

  it("lê o JSON e devolve o item; um aviso antes do JSON é ignorado", async () => {
    const item = await lerTiktokPorYtdlp(URL_DO_VIDEO, {
      executar: async () => ({ stdout: `aviso qualquer\n${JSON.stringify(FIXTURE.comMetricasAltas)}\n`, stderr: "" }),
    });
    expect(item?.playCount).toBe(44800);
  });

  it("o tempo limite do processo vira ErroYtdlpTiktok de tempo limite, sem a linha de comando", async () => {
    const chamada = lerTiktokPorYtdlp(URL_DO_VIDEO, {
      limiteMs: 60_000,
      executar: async () => {
        throw Object.assign(new Error("Command failed: yt-dlp --proxy http://usuario:SENHA@proxy ..."), { killed: true });
      },
    });
    await expect(chamada).rejects.toMatchObject({ motivo: "tempo limite" });
    await expect(chamada).rejects.toThrow("tempo limite");
    await expect(chamada).rejects.not.toThrow(/SENHA/);
  });

  it("o corpo HTML do firewall no lugar do JSON é bloqueio", async () => {
    const chamada = lerTiktokPorYtdlp(URL_DO_VIDEO, { executar: async () => ({ stdout: "<html>Site Maintenance</html>", stderr: "" }) });
    await expect(chamada).rejects.toMatchObject({ motivo: "bloqueio" });
  });

  it("o erro do desafio do firewall é bloqueio, e vale para a rodada inteira", async () => {
    const chamada = lerTiktokPorYtdlp(URL_DO_VIDEO, {
      executar: falhaCom("ERROR: [TikTok] 7600000000000000001: Unable to extract webpage video data; Failed to parse JSON Expecting value"),
    });
    await expect(chamada).rejects.toSatisfy((e: unknown) => e instanceof ErroYtdlpTiktok && e.motivo === "bloqueio" && motivoParaTodaARodada(e.motivo));
  });

  it("proxy sem tráfego ou recusando é proxy (vale para a rodada), e a mensagem não vaza a senha", async () => {
    const chamada = lerTiktokPorYtdlp(URL_DO_VIDEO, { executar: falhaCom("ERROR: Unable to connect to proxy ... Tunnel connection failed: 407 TRAFFIC_EXHAUSTED") });
    await expect(chamada).rejects.toMatchObject({ motivo: "proxy" });
    await expect(chamada).rejects.not.toThrow(/SENHA|usuario/);
  });

  it("vídeo apagado ou privado volta null, sem erro (e sem ir para a reserva paga)", async () => {
    const lido = await lerTiktokPorYtdlp(URL_DO_VIDEO, { executar: falhaCom("ERROR: [TikTok] 7600000000000000001: Video not available") });
    expect(lido).toBeNull();
  });

  it("outra falha é só deste vídeo", async () => {
    const chamada = lerTiktokPorYtdlp(URL_DO_VIDEO, { executar: falhaCom("ERROR: algo que ninguem previu") });
    await expect(chamada).rejects.toSatisfy((e: unknown) => e instanceof ErroYtdlpTiktok && e.motivo === "falhou" && !motivoParaTodaARodada(e.motivo));
  });

  it("JSON sem o id ou sem a conta é falha só deste vídeo", async () => {
    const chamada = lerTiktokPorYtdlp(URL_DO_VIDEO, { executar: async () => ({ stdout: JSON.stringify({ view_count: 5 }), stderr: "" }) });
    await expect(chamada).rejects.toMatchObject({ motivo: "falhou" });
  });
});

describe("pausaEntreLeiturasTiktok", () => {
  it("espera de 3 a 6 s, pelo sorteio", async () => {
    const pedidos: number[] = [];
    await pausaEntreLeiturasTiktok(async (ms) => void pedidos.push(ms), () => 0);
    await pausaEntreLeiturasTiktok(async (ms) => void pedidos.push(ms), () => 1);
    expect(pedidos).toEqual([PAUSA_MIN_MS, PAUSA_MAX_MS]);
    expect([PAUSA_MIN_MS, PAUSA_MAX_MS]).toEqual([3000, 6000]);
  });
});
