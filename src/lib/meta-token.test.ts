import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/lib/config")>();
  return { ...original, config: { ...original.config, metaConexao: { ...original.config.metaConexao, tokenChave: Buffer.alloc(32, 5).toString("base64") } } };
});

import { config } from "@/lib/config";

import { cifrarToken, contextoDoToken, decifrarToken, ErroTokenCifrado } from "./meta-token";

const TOKEN = "EAAtoken-longo-de-teste-que-nunca-deve-aparecer-em-lugar-nenhum";
const CONTEXTO = contextoDoToken(1, "instagram", "ig-1");

describe("meta-token (AES-256-GCM)", () => {
  const chaveOriginal = config.metaConexao.tokenChave;
  beforeEach(() => {
    config.metaConexao.tokenChave = chaveOriginal;
  });
  afterEach(() => {
    config.metaConexao.tokenChave = chaveOriginal;
  });

  it("cifra e decifra de volta o mesmo token", () => {
    expect(decifrarToken(cifrarToken(TOKEN, CONTEXTO), CONTEXTO)).toBe(TOKEN);
  });

  it("o valor guardado nao contem o token, tem o formato v1 e muda a cada cifragem (iv novo)", () => {
    const a = cifrarToken(TOKEN, CONTEXTO);
    const b = cifrarToken(TOKEN, CONTEXTO);
    expect(a).not.toContain(TOKEN);
    expect(a).not.toContain(TOKEN.slice(0, 12));
    expect(a.split(".")).toHaveLength(4);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("um valor cifrado para uma dona nao decifra com o contexto de outra (marca diferente)", () => {
    const valor = cifrarToken(TOKEN, contextoDoToken(1, "instagram", "ig-1"));
    expect(() => decifrarToken(valor, contextoDoToken(2, "instagram", "ig-1"))).toThrow(ErroTokenCifrado);
    expect(() => decifrarToken(valor, contextoDoToken(1, "instagram", "ig-2"))).toThrow(ErroTokenCifrado);
  });

  it("valor adulterado (um byte do texto cifrado, da etiqueta ou do iv) nao decifra", () => {
    const partes = cifrarToken(TOKEN, CONTEXTO).split(".");
    for (const posicao of [1, 2, 3]) {
      const copia = [...partes];
      const buffer = Buffer.from(copia[posicao], "base64url");
      buffer[0] ^= 0xff;
      copia[posicao] = buffer.toString("base64url");
      expect(() => decifrarToken(copia.join("."), CONTEXTO), `parte ${posicao}`).toThrow(ErroTokenCifrado);
    }
  });

  it("chave diferente nao decifra, e o erro nao repete o token nem a chave", () => {
    const valor = cifrarToken(TOKEN, CONTEXTO);
    config.metaConexao.tokenChave = Buffer.alloc(32, 6).toString("base64");
    let mensagem = "";
    try {
      decifrarToken(valor, CONTEXTO);
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toMatch(/decifrar/);
    expect(mensagem).not.toContain(TOKEN);
    expect(mensagem).not.toContain(Buffer.alloc(32, 6).toString("base64"));
  });

  it("formato desconhecido e recusado", () => {
    expect(() => decifrarToken("EAAtexto-puro-sem-cifra", CONTEXTO)).toThrow(/formato/);
    expect(() => decifrarToken("v2.a.b.c", CONTEXTO)).toThrow(/formato/);
  });

  it("sem chave valida, cifrar e decifrar recusam", () => {
    const valor = cifrarToken(TOKEN, CONTEXTO);
    for (const ruim of ["", "curta"]) {
      config.metaConexao.tokenChave = ruim;
      expect(() => cifrarToken(TOKEN, CONTEXTO)).toThrow(/META_TOKEN_CHAVE/);
      expect(() => decifrarToken(valor, CONTEXTO)).toThrow(/META_TOKEN_CHAVE/);
    }
  });

  it("aceita a chave em 64 caracteres hexadecimais", () => {
    config.metaConexao.tokenChave = Buffer.alloc(32, 3).toString("hex");
    expect(decifrarToken(cifrarToken(TOKEN, CONTEXTO), CONTEXTO)).toBe(TOKEN);
  });
});
