import { describe, expect, it } from "vitest";

import { INTERVALO_PADRAO_ENTRE_POSTS_MIN, intervaloEntrePostsMin, publicarImagensAtivo } from "@/config/post-pronto";
import { criarCodigoDaImagem, lerCodigoDaImagem, proporcaoAceita, tipoPelosBytes, VALIDADE_DO_ENDERECO_DA_IMAGEM_MS } from "@/lib/imagens-do-post";

describe("proporção aceita pelo Instagram (de 4:5 a 1,91:1)", () => {
  it.each([
    [1080, 1350, true],
    [1080, 1080, true],
    [1910, 1000, true],
    [1079, 1350, true],
    [1000, 1500, false],
    [2000, 1000, false],
    [0, 100, false],
  ])("%i por %i: %s", (l, a, esperado) => {
    expect(proporcaoAceita(l, a)).toBe(esperado);
  });
});

describe("tipo pelos bytes", () => {
  it("reconhece JPEG, PNG e WEBP e nada mais", () => {
    expect(tipoPelosBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(tipoPelosBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(tipoPelosBytes(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("webp");
    expect(tipoPelosBytes(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(tipoPelosBytes(new Uint8Array())).toBeNull();
  });
});

describe("o código do endereço da imagem", () => {
  const agora = new Date("2026-11-26T12:00:00Z");
  it("vale para o post e a imagem certos, dentro do prazo", () => {
    const codigo = criarCodigoDaImagem(7, 3, agora);
    expect(lerCodigoDaImagem(codigo, agora)).toEqual({ postId: 7, indice: 3 });
    expect(lerCodigoDaImagem(codigo, new Date(agora.getTime() + VALIDADE_DO_ENDERECO_DA_IMAGEM_MS - 1000))).toEqual({ postId: 7, indice: 3 });
  });
  it("não vale vencido, adulterado nem para outra imagem ou outro post", () => {
    const codigo = criarCodigoDaImagem(7, 3, agora);
    expect(lerCodigoDaImagem(codigo, new Date(agora.getTime() + VALIDADE_DO_ENDERECO_DA_IMAGEM_MS + 1000))).toBeNull();
    const [id, indice, vence, assinatura] = codigo.split(".");
    expect(lerCodigoDaImagem([id, "4", vence, assinatura].join("."), agora)).toBeNull();
    expect(lerCodigoDaImagem([8, indice, vence, assinatura].join("."), agora)).toBeNull();
    expect(lerCodigoDaImagem(`${codigo}x`, agora)).toBeNull();
    expect(lerCodigoDaImagem("lixo", agora)).toBeNull();
  });
});

describe("as chaves de ambiente", () => {
  it("a função vem desligada e só abre com 1, true ou sim", () => {
    const antes = process.env.PUBLICAR_IMAGENS_ATIVO;
    try {
      delete process.env.PUBLICAR_IMAGENS_ATIVO;
      expect(publicarImagensAtivo()).toBe(false);
      for (const v of ["", "0", "nao", "talvez"]) {
        process.env.PUBLICAR_IMAGENS_ATIVO = v;
        expect(publicarImagensAtivo()).toBe(false);
      }
      for (const v of ["1", "true", "SIM"]) {
        process.env.PUBLICAR_IMAGENS_ATIVO = v;
        expect(publicarImagensAtivo()).toBe(true);
      }
    } finally {
      if (antes === undefined) delete process.env.PUBLICAR_IMAGENS_ATIVO;
      else process.env.PUBLICAR_IMAGENS_ATIVO = antes;
    }
  });
  it("o intervalo padrão é de 10 minutos e valor ruim cai no padrão", () => {
    const antes = process.env.PUBLICAR_INTERVALO_MIN;
    try {
      delete process.env.PUBLICAR_INTERVALO_MIN;
      expect(intervaloEntrePostsMin()).toBe(INTERVALO_PADRAO_ENTRE_POSTS_MIN);
      process.env.PUBLICAR_INTERVALO_MIN = "25";
      expect(intervaloEntrePostsMin()).toBe(25);
      process.env.PUBLICAR_INTERVALO_MIN = "0";
      expect(intervaloEntrePostsMin()).toBe(0);
      for (const v of ["abc", "-5", ""]) {
        process.env.PUBLICAR_INTERVALO_MIN = v;
        expect(intervaloEntrePostsMin()).toBe(INTERVALO_PADRAO_ENTRE_POSTS_MIN);
      }
    } finally {
      if (antes === undefined) delete process.env.PUBLICAR_INTERVALO_MIN;
      else process.env.PUBLICAR_INTERVALO_MIN = antes;
    }
  });
});
