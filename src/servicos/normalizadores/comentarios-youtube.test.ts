import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { YoutubeCommentThreadsResponse } from "@/jobs/youtube-api";

import { normalizarComentariosYoutube } from "./comentarios-youtube";

function fixture(): YoutubeCommentThreadsResponse {
  const caminho = path.resolve(process.cwd(), "tests/fixtures/comentarios/youtube-comment-threads.json");
  return JSON.parse(readFileSync(caminho, "utf8")) as YoutubeCommentThreadsResponse;
}

describe("normalizarComentariosYoutube", () => {
  const resposta = fixture();

  it("devolve só o id do comentário, o texto limpo, as curtidas e a data: nada de quem escreveu", () => {
    const saida = normalizarComentariosYoutube(resposta);
    expect(saida.length).toBeGreaterThan(10);
    for (const c of saida) {
      expect(Object.keys(c).sort()).toEqual(["curtidas", "idExterno", "publicadoEm", "texto"]);
    }
    const tudo = JSON.stringify(saida);
    expect(tudo).not.toContain("Autor de teste");
    expect(tudo).not.toContain("UCautor");
    expect(tudo).not.toContain("exemplo.invalido/foto");
    expect(tudo).not.toContain("@");
  });

  it("limpa o texto: sem menção, endereço, e-mail, telefone nem entidade", () => {
    const textos = normalizarComentariosYoutube(resposta).map((c) => c.texto);
    expect(textos).toContain("você viu isso? Quanto tempo tem que esperar para secar?");
    expect(textos).toContain("Quanto tempo tem que esperar para secar? Me chama no");
    expect(textos).toContain("Quanto tempo tem que esperar para secar? Veja em ou ligue");
    expect(textos).toContain('Isso & aquilo "funciona" mesmo?');
    for (const t of textos) {
      expect(t).not.toMatch(/https?:|www\.|@|\d{8}/);
    }
  });

  it("descarta o que é curto, só emoji ou só risada", () => {
    const textos = normalizarComentariosYoutube(resposta).map((c) => c.texto);
    expect(textos).not.toContain("top");
    expect(textos.some((t) => /^k+$/.test(t))).toBe(false);
  });

  it("a mesma pessoa colando a mesma frase conta uma vez; pessoas diferentes, cada uma conta", () => {
    const textos = normalizarComentariosYoutube(resposta).map((c) => c.texto.toLowerCase().replace(/[^\p{L} ]/gu, ""));
    // cinco pessoas diferentes + a que colou três vezes (uma só): seis cópias, não oito
    expect(textos.filter((t) => t === "serve em tecido de camurça").length).toBe(6);
  });

  it("guarda as curtidas e a data, e respeita o máximo", () => {
    const todos = normalizarComentariosYoutube(resposta);
    expect(todos[0]).toMatchObject({ idExterno: "UgzTESTE001", curtidas: 14 });
    expect(todos[0].publicadoEm?.toISOString()).toBe("2026-10-04T12:00:00.000Z");
    expect(normalizarComentariosYoutube(resposta, 3)).toHaveLength(3);
  });

  it("uma resposta sem itens, ou com item torto, não quebra", () => {
    expect(normalizarComentariosYoutube({})).toEqual([]);
    expect(normalizarComentariosYoutube({ items: [null, {}, { snippet: {} }, { id: "x", snippet: { topLevelComment: {} } }] })).toEqual([]);
  });
});
